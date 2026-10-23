import { parse } from "../../src/domain/parse";
import { orderNumberSchema } from "../../src/domain/order";
import type { SessionId } from "../../src/domain/session";
import { runSupportTurn, type ScriptedModel, type SupportTurnDependencies } from "../../src/service/agent/support-turn";
import { redisCommand } from "./redis-client";

const sqliteUrl = process.env.SQLITE_URL ?? "http://sqlite:3001";
const redisHost = process.env.REDIS_HOST ?? "redis";
const redisPort = Number(process.env.CACHE_REDIS_PORT ?? "6379");
const cacheKey = "local-load:orders:ada@example.com";
const customerText = "Where is order W002?";
export const expectedReply = "Your order #W002 is shipped.";
const orderFixture = "W002:shipped:1Z";

export type CacheOutcome = "hit" | "miss" | "unavailable";
export type TurnReply = {
  readonly sessionId: SessionId;
  readonly turnId: SessionId;
  readonly reply: string;
  readonly cacheOutcome: CacheOutcome;
};

async function sqlite(path: string, method: string, value?: unknown): Promise<unknown> {
  const response = await fetch(`${sqliteUrl}${path}`, {
    method,
    ...(value === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`SQLite ${method} ${path} returned ${response.status}`);
  return response.json();
}

const model: ScriptedModel = {
  complete({ messages }) {
    if (messages.some((message) => message.role === "tool")) return { text: expectedReply };
    return {
      text: "Looking up the order.",
      toolCalls: [{ id: "lookup-1", name: "lookup_order", args: { email: "ada@example.com", order_number: "W002" } }],
    };
  },
};

function dependencies(id: SessionId, recordCache: (outcome: CacheOutcome) => void): SupportTurnDependencies {
  return {
    orders: {
      catalog: {
        async listOrdersForEmail(email) {
          if (email !== "ada@example.com") return { kind: "ready", orders: [] };
          let cached: string | null;
          let cacheAvailable = true;
          try {
            cached = await redisCommand(redisHost, redisPort, "GET", cacheKey);
          } catch {
            recordCache("unavailable");
            cached = null;
            cacheAvailable = false;
          }
          if (cached === null && cacheAvailable) {
            try {
              await redisCommand(redisHost, redisPort, "SET", cacheKey, orderFixture, "EX", "600");
              recordCache("miss");
            } catch {
              recordCache("unavailable");
            }
          } else if (cached === orderFixture) {
            recordCache("hit");
          } else if (cached !== null) {
            throw new Error("order fixture cache is corrupt");
          }
          const orderNumber = parse(orderNumberSchema, "W002");
          if (!orderNumber.ok) throw new Error("fixture order number is invalid");
          return { kind: "ready", orders: [{ orderNumber: orderNumber.value, status: "shipped", trackingNumber: "1Z" }] };
        },
      },
      streaks: {
        async read() {
          const raw = await sqlite("/sessions", "POST", { id });
          if (typeof raw !== "object" || raw === null || !("streak" in raw) || raw.streak !== 0) {
            return { kind: "unavailable" };
          }
          return { kind: "ready", streak: 0 };
        },
        async write(_sessionId, streak) {
          await sqlite("/streak", "PUT", { id, streak });
          return { kind: "ready" };
        },
      },
    },
    products: {
      catalog: {
        async matchProducts() { throw new Error("product search is outside this scenario"); },
        async listProducts() { throw new Error("product search is outside this scenario"); },
      },
      embedder: { async embed() { throw new Error("product search is outside this scenario"); } },
    },
    promotion: {
      session: { id, localTimezone: { kind: "unresolved" }, unmatchedOrderStreak: 0 },
      now: new Date("2026-10-08T00:00:00Z"),
      store: { async insertOrReuse() { throw new Error("promotion is outside this scenario"); } },
    },
    handoff: {
      turnId: id,
      proposalId: id,
      store: {
        listProposals() { return []; },
        findProposalForTurn() { return undefined; },
        findProposal() { return undefined; },
        saveProposal() { throw new Error("handoff is outside this scenario"); },
        findCase() { return undefined; },
        saveCase() { throw new Error("handoff is outside this scenario"); },
      },
    },
  };
}

export async function runSimulatedTurn(id: SessionId): Promise<TurnReply> {
  let cacheOutcome: CacheOutcome = "unavailable";
  const result = await runSupportTurn({
    model,
    sessionId: id,
    customerText,
    priorMessages: [],
    dependencies: dependencies(id, (outcome) => { cacheOutcome = outcome; }),
  });
  if (result.draft !== expectedReply || result.toolTraces.length !== 1 || result.toolTraces[0]?.tool !== "lookup_order") {
    throw new Error("agent result did not match the expected order lookup");
  }
  const lookup = result.toolPayloads[0];
  if (typeof lookup !== "object" || lookup === null || !("kind" in lookup) || lookup.kind !== "orders_found") {
    throw new Error(`order lookup failed: ${JSON.stringify(lookup)}`);
  }
  await sqlite("/messages", "POST", { sessionId: id, turnId: id, customerText, reply: result.draft });
  return { sessionId: id, turnId: id, reply: result.draft, cacheOutcome };
}
