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
import type { ProposalStore } from "../business/handoff/handoff";
import type { CatalogOrder, OrderCatalog, OrderStreakStore } from "../business/order/lookup-order";
import type { ProductSearchDependencies } from "../business/product/search-products";
import type { EarlyRisersCodeStore } from "../business/promotion/claim-early-risers";
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
    priorMessages: [],
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
    skippedCalls: [],
    chunkPlans: [
      {
        chunkIndex: 0,
        calls: [{ callId: "lookup-1", tool: "lookup_order", kind: "write" }],
        parallelReadCallIds: [],
        writeOrderCallIds: ["lookup-1"],
      },
    ],
    unmatchedOrderCount: 0,
    handoffDraft: undefined,
    contextSummary: null,
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
    priorMessages: [],
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
    priorMessages: [],
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
    priorMessages: [],
    model,
    sessionId,
    customerText: "Keep looking up W002.",
    dependencies: dependencies(streakStore(1)),
  });

  expect(calls).toBe(6);
  expect(result.draft).toBe("Lookup round 6.");
  expect(result.skippedCalls).toEqual([]);
  expect(result.toolPayloads).toEqual(Array.from({ length: 6 }, () => shippedOrder));
  expect(result.toolTraces).toEqual(
    Array.from({ length: 6 }, (_unused, index) => ({
      callId: `call-${index + 1}`,
      tool: "lookup_order" as const,
    })),
  );
});

test("eight product searches finish in one chunk and the reply names none left over", async () => {
  const seen: { assistants: number; tools: number }[] = [];
  const model: ScriptedModel = {
    async complete(input) {
      seen.push({
        assistants: input.messages.filter((message) => message.role === "assistant").length,
        tools: input.messages.filter((message) => message.role === "tool").length,
      });
      if (input.messages.some((message) => message.role === "tool")) {
        return { text: "Eight products are listed." };
      }
      return { text: "Checking eight products.", toolCalls: searchCalls(8) };
    },
  };

  const result = await runSupportTurn({
    priorMessages: [],
    model,
    sessionId,
    customerText: "List eight products.",
    dependencies: listedProducts(dependencies(streakStore(0))),
  });

  expect(result.toolPayloads).toEqual(Array.from({ length: 8 }, () => listedProduct));
  expect(result.draft).toBe("Eight products are listed.");
  expect(result.skippedCalls).toEqual([]);
  expect(seen).toEqual([
    { assistants: 0, tools: 0 },
    { assistants: 1, tools: 8 },
  ]);
});

test("nine product searches run across two chunks and the reply has no refusal", async () => {
  const seen: { assistants: number; tools: number }[] = [];
  const model: ScriptedModel = {
    async complete(input) {
      seen.push({
        assistants: input.messages.filter((message) => message.role === "assistant").length,
        tools: input.messages.filter((message) => message.role === "tool").length,
      });
      if (input.messages.some((message) => message.role === "tool")) {
        return { text: "Nine products are listed." };
      }
      return { text: "Checking nine products.", toolCalls: searchCalls(9) };
    },
  };

  const result = await runSupportTurn({
    priorMessages: [],
    model,
    sessionId,
    customerText: "List nine products.",
    dependencies: listedProducts(dependencies(streakStore(0))),
  });

  expect(result.toolPayloads).toEqual(Array.from({ length: 9 }, () => listedProduct));
  expect(result.toolTraces.map((trace) => trace.callId)).toEqual([
    "search-1",
    "search-2",
    "search-3",
    "search-4",
    "search-5",
    "search-6",
    "search-7",
    "search-8",
    "search-9",
  ]);
  expect(result.draft).toBe("Nine products are listed.");
  expect(result.skippedCalls).toEqual([]);
  expect(seen).toEqual([
    { assistants: 0, tools: 0 },
    { assistants: 1, tools: 9 },
  ]);
});

test("nine searches with one tool round leave the ninth named and unrun", async () => {
  let calls = 0;
  const model: ScriptedModel = {
    complete() {
      calls += 1;
      if (calls > 1) throw new Error("second model call");
      return { text: "Checking nine products.", toolCalls: searchCalls(9) };
    },
  };

  const result = await runSupportTurn({
    priorMessages: [],
    model,
    sessionId,
    customerText: "List nine products.",
    maxToolRounds: 1,
    dependencies: listedProducts(dependencies(streakStore(0))),
  });

  expect(calls).toBe(1);
  expect(result.toolPayloads).toHaveLength(8);
  expect(result.toolTraces.map((trace) => trace.callId)).toEqual([
    "search-1",
    "search-2",
    "search-3",
    "search-4",
    "search-5",
    "search-6",
    "search-7",
    "search-8",
  ]);
  expect(result.skippedCalls).toEqual([
    { callId: "search-9", tool: "search_products", args: { mode: "list" } },
  ]);
  expect(result.draft).toBe(
    "Checking nine products. I could not run these checks in this message: search_products (mode=list)",
  );
});

test("two Early Risers claims in one chunk return the same code", async () => {
  const issued: string[] = [];
  const model: ScriptedModel = {
    async complete(input) {
      if (input.messages.some((message) => message.role === "tool")) return { text: "Same code twice." };
      return {
        text: "Claiming Early Risers.",
        toolCalls: [
          { id: "claim-1", name: "claim_early_risers", args: { request: "yes" } },
          { id: "claim-2", name: "claim_early_risers", args: { request: "yes again" } },
        ],
      };
    },
  };

  const result = await runSupportTurn({
    priorMessages: [],
    model,
    sessionId,
    customerText: "Yes, Early Risers.",
    dependencies: {
      ...dependencies(streakStore(0)),
      promotion: {
        session: {
          id: parsedSession(),
          localTimezone: { kind: "resolved", name: "America/Chicago" },
          unmatchedOrderStreak: 0,
        },
        now: new Date("2026-10-08T13:00:00.000Z"),
        store: reusingCodeStore(),
        issueCode() {
          const code = issued.length === 0 ? "EARLY-AAAAAAAA" : "EARLY-BBBBBBBB";
          issued.push(code);
          return code;
        },
      },
    },
  });

  expect(issued).toEqual(["EARLY-AAAAAAAA"]);
  expect(result.toolPayloads).toEqual([
    {
      kind: "promotion_eligible",
      campaign: "Early Risers",
      code: "EARLY-AAAAAAAA",
      discountPercent: 10,
      validOn: "2026-10-08",
      expiresAt: "2026-10-09T00:00:00-05:00",
      timezone: "America/Chicago",
    },
    {
      kind: "promotion_eligible",
      campaign: "Early Risers",
      code: "EARLY-AAAAAAAA",
      discountPercent: 10,
      validOn: "2026-10-08",
      expiresAt: "2026-10-09T00:00:00-05:00",
      timezone: "America/Chicago",
    },
  ]);
  expect(result.draft).toBe("Same code twice.");
});

test("a handoff in a later chunk keeps the first draft", async () => {
  const model: ScriptedModel = {
    async complete(input) {
      if (input.messages.some((message) => message.role === "tool")) return { text: "One proposal." };
      return {
        text: "Preparing a person.",
        toolCalls: [
          {
            id: "handoff-1",
            name: "capture_handoff",
            args: {
              contact_email: "person@example.com",
              reason: "I need a person",
              order_number: "ab12",
            },
          },
          ...searchCalls(7),
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
    priorMessages: [],
    model,
    sessionId,
    customerText: "I need a person, and also these products.",
    dependencies: listedProducts(dependencies(streakStore(0))),
  });

  expect(result.handoffDraft).toEqual(firstHandoff.draft);
  expect(result.toolPayloads[0]).toEqual(firstHandoff);
  expect(result.toolPayloads[8]).toEqual(firstHandoff);
  expect(result.toolPayloads).toHaveLength(9);
  expect(result.draft).toBe("One proposal.");
  expect(result.skippedCalls).toEqual([]);
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
      priorMessages: [],
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
      priorMessages: [],
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

test("search uses the turn match threshold and candidate limit", async () => {
  let toolContent = "";
  const model: ScriptedModel = {
    async complete(input) {
      const tool = input.messages.find((message) => message.role === "tool");
      if (tool?.role === "tool") {
        toolContent = tool.content;
        return { text: "Camp Mug is in stock." };
      }
      return {
        text: "Searching.",
        toolCalls: [
          { id: "search-1", name: "search_products", args: { mode: "semantic", query: "mug" } },
        ],
      };
    },
  };

  const result = await runSupportTurn({
    priorMessages: [],
    model,
    sessionId,
    customerText: "Do you have a mug?",
    productMatchThreshold: 0.5,
    maxProductCandidates: 1,
    dependencies: {
      ...dependencies(streakStore(0)),
      products: {
        embedder: {
          async embed() {
            return [1];
          },
        },
        catalog: {
          async matchProducts() {
            return [
              { product: { name: "Camp Mug", stockLevel: 4 }, similarity: 0.91 },
              { product: { name: "Spare Lid", stockLevel: 1 }, similarity: 0.4 },
            ];
          },
          async listProducts() {
            return [];
          },
        },
      },
    },
  });

  expect(JSON.parse(toolContent)).toEqual({
    kind: "products_found",
    mode: "semantic",
    matchQuality: "strong",
    absent: false,
    filtersApplied: {},
    catalogFields: ["name", "stockLevel"],
    missingFields: ["price", "size", "color", "rating", "stock-keeping code"],
    products: [{ name: "Camp Mug", stockLevel: 4 }],
    alternatives: [{ name: "Spare Lid", stockLevel: 1 }],
  });
  expect(result.draft).toBe("Camp Mug is in stock.");
});

test("the summarize node keeps the current turn raw once history passes 70 percent", async () => {
  const seen: { systemPrompt: string; messages: readonly { role: string; content: string }[] }[] = [];
  let summaries = 0;
  const oldTurn = Array.from({ length: 4000 }, (_item, index) => `fact${index}`).join(" ");
  const model: ScriptedModel = {
    async summarize() {
      summaries += 1;
      return "Earlier order facts.";
    },
    async complete(input) {
      seen.push({
        systemPrompt: input.systemPrompt,
        messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      });
      return { text: "Your order is shipped." };
    },
  };

  const result = await runSupportTurn({
    priorMessages: [
      { role: "user", content: oldTurn },
      { role: "assistant", content: "Noted.", toolCalls: [] },
    ],
    priorSequences: [1, 2],
    contextWindowTokens: 8_000,
    priorSummary: null,
    model,
    sessionId,
    threadId: sessionId,
    customerText: "Where is order W002?",
    dependencies: dependencies(streakStore(0)),
  });

  expect(summaries).toBe(1);
  expect(seen[0]?.systemPrompt).toContain("Earlier order facts.");
  expect(seen[0]?.messages.map((message) => message.content)).toEqual([
    "Noted.",
    "Where is order W002?",
  ]);
  expect(seen[0]?.messages.some((message) => message.content.includes("fact0"))).toBe(false);
  expect(result.contextSummary).toEqual({ summary: "Earlier order facts.", coveredThrough: 1 });
});

test("a model context fallback never persists a summary it omitted", async () => {
  const oldTurn = Array.from({ length: 4000 }, (_item, index) => `fact${index}`).join(" ");
  const model: ScriptedModel = {
    async summarize() { return "Earlier order facts."; },
    async complete() { return { text: "Your order is shipped.", contextFallbackUsed: true }; },
  };
  const result = await runSupportTurn({
    priorMessages: [{ role: "user", content: oldTurn }],
    priorSequences: [1],
    contextWindowTokens: 8_000,
    model,
    sessionId,
    customerText: "Where is order W002?",
    dependencies: dependencies(streakStore(0)),
  });
  expect(result.draft).toBe("Your order is shipped.");
  expect(result.contextSummary).toBeNull();
});

test("a summary provider failure still answers with bounded raw history and stores no summary", async () => {
  const seen: { systemPrompt: string; messages: readonly { role: string; content: string }[] }[] = [];
  const oldTurn = Array.from({ length: 4000 }, (_item, index) => `fact${index}`).join(" ");
  const model: ScriptedModel = {
    async summarize() {
      throw new Error("summary provider unavailable");
    },
    async complete(input) {
      seen.push({
        systemPrompt: input.systemPrompt,
        messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      });
      return { text: "Your order is shipped." };
    },
  };

  const result = await runSupportTurn({
    priorMessages: [
      { role: "user", content: oldTurn },
      { role: "assistant", content: "Noted.", toolCalls: [] },
    ],
    priorSequences: [1, 2],
    contextWindowTokens: 8_000,
    contextHardTokens: 7_000,
    priorSummary: null,
    model,
    sessionId,
    customerText: "Where is order W002?",
    dependencies: dependencies(streakStore(0)),
  });

  expect(seen).toHaveLength(1);
  expect(seen[0]?.messages.at(-1)?.content).toBe("Where is order W002?");
  expect(seen[0]?.systemPrompt).not.toContain("summary provider unavailable");
  expect(result.draft).toBe("Your order is shipped.");
  expect(result.contextSummary).toBeNull();
});

const listedProduct = {
  kind: "products_found",
  filtersApplied: {},
  catalogFields: ["name", "stockLevel"],
  missingFields: ["price", "size", "color", "rating", "stock-keeping code"],
  mode: "list",
  absent: false,
  products: [],
};

function searchCalls(count: number) {
  return Array.from({ length: count }, (_item, index) => ({
    id: `search-${index + 1}`,
    name: "search_products" as const,
    args: { mode: "list" as const },
  }));
}

function listedProducts(base: SupportTurnDependencies): SupportTurnDependencies {
  return {
    ...base,
    products: {
      catalog: {
        async matchProducts() {
          return [];
        },
        async listProducts() {
          return [];
        },
      },
      embedder: {
        async embed() {
          return [];
        },
      },
    },
  };
}

function reusingCodeStore(): EarlyRisersCodeStore {
  const rows = new Map<string, Awaited<ReturnType<EarlyRisersCodeStore["insertOrReuse"]>>>();
  return {
    async insertOrReuse(key, create) {
      const id = `${key.sessionId}|${key.validOn}`;
      const existing = rows.get(id);
      if (existing !== undefined) return existing;
      const created = create();
      rows.set(id, created);
      return created;
    },
  };
}

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
    listProposals(session: SessionId) {
      return [...proposals.values()].filter((proposal) => proposal.sessionId === session);
    },
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
