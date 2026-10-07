import { expect, test } from "vitest";
import type { Proposal, SupportCase } from "../../domain/handoff";
import { parse, type Parsed } from "../../domain/parse";
import { orderNumberSchema, type OrderNumber } from "../../domain/order";
import {
  sessionIdSchema,
  type Session,
  type SessionId,
  type UnmatchedOrderStreak,
} from "../../domain/session";
import type { TurnId } from "../../domain/turn";
import type { ProposalStore } from "../handoff/handoff";
import type { CatalogOrder, OrderCatalog, OrderStreakStore } from "../order/lookup-order";
import type { ProductSearchDependencies } from "../product/search-products";
import type { EarlyRisersCodeStore } from "../promotion/claim-early-risers";
import { runSupportTurn, type ScriptedModel, type SupportTurnDependencies } from "./support-turn";

const sessionId = "11111111-1111-4111-8111-111111111111";
const otherThreadId = "99999999-9999-4999-8999-999999999999";
const turnId = "22222222-2222-4222-8222-222222222222";
const proposalId = "33333333-3333-4333-8333-333333333333";

const shippedOrder = {
  kind: "orders_found",
  orders: [
    {
      orderNumber: "#W002",
      status: "shipped",
      tracking: {
        kind: "tracked",
        trackingNumber: "1Z",
        trackingUrl: "https://track.example/1Z",
      },
    },
  ],
  unmatched_order_count: 0,
  handoff_eligible: false,
};

const processingOrder = {
  kind: "orders_found",
  orders: [
    {
      orderNumber: "#W003",
      status: "processing",
      tracking: { kind: "untracked" },
    },
  ],
  unmatched_order_count: 0,
  handoff_eligible: false,
};

const firstHandoff = {
  kind: "handoff_proposed",
  draft: {
    contactEmail: "person@example.com",
    reason: "I need a person",
    orderNumber: "#AB12",
  },
};

test("a scripted lookup_order returns the service payload and a filtered draft", async () => {
  const streaks = streakStore(1);
  let toolContent = "";
  const model: ScriptedModel = {
    async complete(input) {
      const tool = input.messages.find((message) => message.role === "tool");
      if (tool?.role === "tool") {
        toolContent = tool.content;
        return { text: "Your order #W002 is shipped. The database stored it." };
      }
      return {
        text: "Looking up the order.",
        toolCalls: [
          {
            id: "lookup-1",
            name: "lookup_order",
            args: { email: "ada@example.com", order_number: "w002" },
          },
        ],
      };
    },
  };

  const result = await runSupportTurn({
    model,
    sessionId,
    threadId: sessionId,
    customerText: "Where is order W002?",
    dependencies: dependencies(streaks),
  });

  expect(toolContent).toBe(JSON.stringify(shippedOrder));
  expect(result).toEqual({
    draft: "Your order #W002 is shipped.",
    toolPayloads: [shippedOrder],
    toolTraces: [{ callId: "lookup-1", tool: "lookup_order" }],
    unmatchedOrderCount: 0,
    handoffDraft: undefined,
  });
  expect(streaks.current()).toBe(0);
});

test("two lookup_order calls in one round keep their result order", async () => {
  const streaks = streakStore(1);
  const toolContents: string[] = [];
  const model: ScriptedModel = {
    async complete(input) {
      for (const message of input.messages) {
        if (message.role === "tool") toolContents.push(message.content);
      }
      if (toolContents.length > 0) return { text: "Both orders are in." };
      return {
        text: "Looking up both orders.",
        toolCalls: [
          {
            id: "lookup-1",
            name: "lookup_order",
            args: { email: "ada@example.com", order_number: "W002" },
          },
          {
            id: "lookup-2",
            name: "lookup_order",
            args: { email: "ada@example.com", order_number: "W003" },
          },
        ],
      };
    },
  };

  const result = await runSupportTurn({
    model,
    sessionId,
    customerText: "Check W002 and W003.",
    dependencies: dependencies(streaks),
  });

  expect(toolContents).toEqual([JSON.stringify(shippedOrder), JSON.stringify(processingOrder)]);
  expect(result.toolPayloads).toEqual([shippedOrder, processingOrder]);
  expect(result.toolTraces).toEqual([
    { callId: "lookup-1", tool: "lookup_order" },
    { callId: "lookup-2", tool: "lookup_order" },
  ]);
  expect(result.draft).toBe("Both orders are in.");
});

test("capture_handoff puts the first draft on handoffDraft", async () => {
  const model: ScriptedModel = {
    async complete(input) {
      const sawTool = input.messages.some((message) => message.role === "tool");
      if (sawTool) return { text: "Please confirm or cancel." };
      return {
        text: "Preparing a person.",
        toolCalls: [
          {
            id: "handoff-1",
            name: "capture_handoff",
            args: {
              contact_email: " Person@Example.com ",
              reason: "  I need a person  ",
              order_number: "ab12",
            },
          },
          {
            id: "handoff-2",
            name: "capture_handoff",
            args: {
              contact_email: "other@example.com",
              reason: "A different reason",
              order_number: "zz99",
            },
          },
        ],
      };
    },
  };

  const result = await runSupportTurn({
    model,
    sessionId,
    customerText: "I need a person at person@example.com about AB12.",
    dependencies: dependencies(streakStore(0)),
  });

  expect(result.handoffDraft).toEqual(firstHandoff.draft);
  expect(result.toolPayloads).toEqual([firstHandoff, firstHandoff]);
  expect(result.draft).toBe("Please confirm or cancel.");
});

test("a seventh tool round does not call the model again", async () => {
  let calls = 0;
  const model: ScriptedModel = {
    complete() {
      calls += 1;
      if (calls > 6) throw new Error("seventh model call");
      return {
        text: `Lookup round ${calls}.`,
        toolCalls: [
          {
            id: `call-${calls}`,
            name: "lookup_order",
            args: { email: "ada@example.com", order_number: "W002" },
          },
        ],
      };
    },
  };

  const result = await runSupportTurn({
    model,
    sessionId,
    customerText: "Keep looking up W002.",
    dependencies: dependencies(streakStore(1)),
  });

  expect(calls).toBe(6);
  expect(result.draft).toBe("Lookup round 6.");
  expect(result.toolPayloads).toEqual(Array.from({ length: 6 }, () => shippedOrder));
  expect(result.toolTraces).toEqual(
    Array.from({ length: 6 }, (_unused, index) => ({
      callId: `call-${index + 1}`,
      tool: "lookup_order" as const,
    })),
  );
});

test("a supplied thread id that differs from the session id throws before the model runs", async () => {
  const streaks = streakStore(1);
  let calls = 0;
  const model: ScriptedModel = {
    complete() {
      calls += 1;
      return {
        text: "Looking.",
        toolCalls: [
          {
            id: "lookup-1",
            name: "lookup_order",
            args: { email: "ada@example.com", order_number: "W002" },
          },
        ],
      };
    },
  };

  await expect(
    runSupportTurn({
      model,
      sessionId,
      threadId: otherThreadId,
      customerText: "Where is order W002?",
      dependencies: dependencies(streaks),
    }),
  ).rejects.toThrow("thread_id does not match session id");
  expect(calls).toBe(0);
  expect(streaks.current()).toBe(1);
});

test("an aborted deadline throws before tool work", async () => {
  const streaks = streakStore(1);
  const controller = new AbortController();
  let calls = 0;
  const model: ScriptedModel = {
    complete() {
      calls += 1;
      controller.abort();
      return {
        text: "Looking.",
        toolCalls: [
          {
            id: "lookup-1",
            name: "lookup_order",
            args: { email: "ada@example.com", order_number: "W002" },
          },
        ],
      };
    },
  };

  await expect(
    runSupportTurn({
      model,
      sessionId,
      customerText: "Where is order W002?",
      signal: controller.signal,
      dependencies: dependencies(streaks),
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
  expect(streaks.current()).toBe(1);
});

function dependencies(streaks: OrderStreakStore): SupportTurnDependencies {
  return {
    orders: {
      catalog: catalog("ada@example.com", [
        order("W002", "shipped", "1Z"),
        order("W003", "processing", null),
      ]),
      streaks,
    },
    products: idleProducts(),
    promotion: {
      session: promotionSession(parsedSession()),
      now: new Date("2026-10-08T00:00:00.000Z"),
      store: idlePromotionStore(),
    },
    handoff: {
      store: memoryProposalStore(),
      turnId,
      proposalId,
    },
  };
}

function parsed<T>(result: Parsed<T>): T {
  if (!result.ok) throw new Error("test fixture did not parse");
  return result.value;
}

function parsedSession(): SessionId {
  return parsed(parse(sessionIdSchema, sessionId));
}

function number(raw: string): OrderNumber {
  return parsed(parse(orderNumberSchema, raw));
}

function order(rawNumber: string, status: string, trackingNumber: string | null): CatalogOrder {
  return { orderNumber: number(rawNumber), status, trackingNumber };
}

function catalog(email: string, orders: readonly CatalogOrder[]): OrderCatalog {
  return {
    async listOrdersForEmail(requested) {
      if (requested !== email) return { kind: "ready", orders: [] };
      return { kind: "ready", orders };
    },
  };
}

function streakStore(initial: UnmatchedOrderStreak): OrderStreakStore & {
  current(): UnmatchedOrderStreak | undefined;
} {
  const id = parsedSession();
  const counts = new Map<SessionId, UnmatchedOrderStreak>([[id, initial]]);
  return {
    async read(sessionIdToRead) {
      const streak = counts.get(sessionIdToRead);
      if (streak === undefined) return { kind: "unavailable" };
      return { kind: "ready", streak };
    },
    async write(sessionIdToWrite, streak) {
      if (!counts.has(sessionIdToWrite)) return { kind: "unavailable" };
      counts.set(sessionIdToWrite, streak);
      return { kind: "ready" };
    },
    current() {
      return counts.get(id);
    },
  };
}

function promotionSession(id: SessionId): Session {
  return {
    id,
    localTimezone: { kind: "unresolved" },
    unmatchedOrderStreak: 0,
  };
}

function idleProducts(): ProductSearchDependencies {
  return {
    catalog: {
      async matchProducts() {
        throw new Error("search was not part of this turn");
      },
      async listProducts() {
        throw new Error("search was not part of this turn");
      },
    },
    embedder: {
      async embed() {
        throw new Error("search was not part of this turn");
      },
    },
  };
}

function idlePromotionStore(): EarlyRisersCodeStore {
  return {
    async insertOrReuse() {
      throw new Error("claim was not part of this turn");
    },
  };
}

function memoryProposalStore(): ProposalStore {
  const proposals = new Map<string, Proposal>();
  const proposalIdByTurn = new Map<string, string>();
  const cases = new Map<string, SupportCase>();
  return {
    findProposalForTurn(session: SessionId, turn: TurnId) {
      return proposals.get(proposalIdByTurn.get(`${session}\0${turn}`) ?? "");
    },
    findProposal(id: string) {
      return proposals.get(id);
    },
    saveProposal(proposal: Proposal) {
      proposals.set(proposal.id, proposal);
      proposalIdByTurn.set(`${proposal.sessionId}\0${proposal.turnId}`, proposal.id);
    },
    findCase(id: string) {
      return cases.get(id);
    },
    saveCase(supportCase: SupportCase) {
      cases.set(supportCase.id, supportCase);
    },
  };
}
