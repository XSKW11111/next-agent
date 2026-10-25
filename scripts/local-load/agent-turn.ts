import { parse } from "../../src/domain/parse";
import { orderNumberSchema } from "../../src/domain/order";
import type { SessionId } from "../../src/domain/session";
import type { Proposal, SupportCase } from "../../src/domain/handoff";
import type { EarlyRisersCodeRecord } from "../../src/service/business/promotion/claim-early-risers";
import { runSupportTurn, type ScriptedModel, type SupportTurnDependencies } from "../../src/service/agent/support-turn";
import { redisCommand } from "./redis-client";
import type { TurnTrace } from "./turn-trace";
import { scenarioForIntent, validateScenarioResult, type Intent, type Scenario } from "./scenarios";

const sqliteUrl = process.env.SQLITE_URL ?? "http://sqlite:3001";
const redisHost = process.env.REDIS_HOST ?? "redis";
const redisPort = Number(process.env.CACHE_REDIS_PORT ?? "6379");
const cacheKey = "local-load:orders:ada@example.com";
const orderFixture = "W002:shipped:1Z";

export type CacheOutcome = "hit" | "miss" | "unavailable" | "not_used";
export type TurnReply = {
  readonly intent: Intent;
  readonly tool: Scenario["tool"];
  readonly resultKind: string;
  readonly sessionId: SessionId;
  readonly turnId: SessionId;
  readonly reply: string;
  readonly cacheOutcome: CacheOutcome;
  readonly traceId: string;
  readonly estimatedTokens: { readonly input: number; readonly output: number };
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

function dependencies(id: SessionId, trace: TurnTrace, recordCache: (outcome: CacheOutcome) => void): SupportTurnDependencies {
  const promotionCodes = new Map<string, EarlyRisersCodeRecord>();
  const proposals = new Map<string, Proposal>();
  const cases = new Map<string, SupportCase>();
  return {
    orders: {
      catalog: {
        async listOrdersForEmail(email) {
          if (email !== "ada@example.com") return { kind: "ready", orders: [] };
          let cached: string | null;
          let cacheAvailable = true;
          try {
            cached = await trace.span("redis.get", () => redisCommand(redisHost, redisPort, "GET", cacheKey));
          } catch {
            recordCache("unavailable");
            cached = null;
            cacheAvailable = false;
          }
          if (cached === null && cacheAvailable) {
            try {
              await trace.span("redis.set", () => redisCommand(redisHost, redisPort, "SET", cacheKey, orderFixture, "EX", "600"));
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
          const raw = await trace.span("sqlite.sessions", () => sqlite("/sessions", "POST", { id }));
          if (typeof raw !== "object" || raw === null || !("streak" in raw) || raw.streak !== 0) {
            return { kind: "unavailable" };
          }
          return { kind: "ready", streak: 0 };
        },
        async write(_sessionId, streak) {
          await trace.span("sqlite.streak", () => sqlite("/streak", "PUT", { id, streak }));
          return { kind: "ready" };
        },
      },
    },
    products: {
      catalog: {
        async matchProducts() { return [{ product: { name: "Camp Mug", stockLevel: 4 }, similarity: 0.91 }]; },
        async listProducts() { return [{ name: "Camp Mug", stockLevel: 4 }]; },
      },
      embedder: { async embed() { return [1]; } },
    },
    promotion: {
      session: { id, localTimezone: { kind: "resolved", name: "Asia/Shanghai" }, unmatchedOrderStreak: 0 },
      now: new Date("2026-10-08T00:00:00Z"),
      store: { async insertOrReuse(key, create) {
        const identity = `${key.sessionId}|${key.validOn}`;
        const stored = promotionCodes.get(identity);
        if (stored !== undefined) return stored;
        const issued = create();
        promotionCodes.set(identity, issued);
        return issued;
      } },
      issueCode: () => "EARLY-LOCAL123",
    },
    handoff: {
      turnId: id,
      proposalId: id,
      store: {
        listProposals(sessionId) { return [...proposals.values()].filter((proposal) => proposal.sessionId === sessionId); },
        findProposalForTurn(sessionId, turnId) {
          return [...proposals.values()].find((proposal) => proposal.sessionId === sessionId && proposal.turnId === turnId);
        },
        findProposal(proposalId) { return proposals.get(proposalId); },
        saveProposal(proposal) { proposals.set(proposal.id, proposal); },
        findCase(caseId) { return cases.get(caseId); },
        saveCase(supportCase) { cases.set(supportCase.id, supportCase); },
      },
    },
  };
}

export async function runSimulatedTurn(id: SessionId, intent: Intent, trace: TurnTrace): Promise<TurnReply> {
  const scenario = scenarioForIntent(intent);
  let cacheOutcome: CacheOutcome = "not_used";
  const model: ScriptedModel = {
    complete({ messages }) {
      if (messages.some((message) => message.role === "tool")) return { text: scenario.reply };
      return { text: `Running ${scenario.tool}.`, toolCalls: [{ id: "tool-1", name: scenario.tool, args: scenario.args }] };
    },
  };
  const tracedModel: ScriptedModel = {
    async complete(input) {
      const output = await trace.span("model.complete", async () => model.complete(input));
      trace.countModelCall(input, output);
      return output;
    },
  };
  const result = await runSupportTurn({
    model: tracedModel,
    sessionId: id,
    customerText: scenario.customerText,
    priorMessages: [],
    dependencies: dependencies(id, trace, (outcome) => { cacheOutcome = outcome; }),
  });
  const payload = result.toolPayloads[0];
  const kind = typeof payload === "object" && payload !== null && "kind" in payload ? payload.kind : undefined;
  if (result.toolTraces.length !== 1 || result.toolPayloads.length !== 1 ||
      !validateScenarioResult(scenario, result.toolTraces[0]?.tool ?? "lookup_order", kind, payload, result.draft)) {
    throw new Error(`agent result did not match ${intent}`);
  }
  trace.recordTool(scenario.tool, scenario.resultKind);
  await trace.span("sqlite.messages", () => sqlite("/messages", "POST", { sessionId: id, turnId: id,
    customerText: scenario.customerText, reply: result.draft }));
  const estimatedTokens = trace.snapshot("ok").estimatedTokens;
  return { intent, tool: scenario.tool, resultKind: scenario.resultKind, sessionId: id, turnId: id,
    reply: result.draft, cacheOutcome, traceId: id,
    estimatedTokens: { input: estimatedTokens.input, output: estimatedTokens.output } };
}
