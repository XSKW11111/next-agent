import { expect, test } from "vitest";
import { parse, type Parsed } from "../../../domain/parse";
import {
  sessionIdSchema,
  type Session,
  type SessionId,
  type UnmatchedOrderStreak,
} from "../../../domain/session";
import { parseTurn } from "../../../domain/turn";
import type { Proposal, SupportCase } from "../../../domain/handoff";
import { captureHandoff, type ProposalStore } from "../../../service/handoff/handoff";
import type { OrderCatalog, OrderStreakStore } from "../../../service/order/lookup-order";
import type { ProductSearchDependencies } from "../../../service/product/search-products";
import type { EarlyRisersCodeStore } from "../../../service/promotion/claim-early-risers";
import type { ScriptedModel, SupportTurnDependencies } from "../../../service/agent/support-turn";
import type { SequenceUpdate, TurnMessage } from "../../../service/turn/message-store";
import { POST as createSession } from "./sessions/route";
import { GET as readMessages, POST as sendMessage } from "./sessions/[id]/messages/route";
import { POST as confirmProposal } from "./sessions/[id]/handoffs/[proposalId]/confirm/route";
import { POST as cancelProposal } from "./sessions/[id]/handoffs/[proposalId]/cancel/route";
import type { ChatMessageLog, ChatRuntime, SessionStore } from "./runtime";

const sessionId = "11111111-1111-4111-8111-111111111111";
const otherSessionId = "55555555-5555-4555-8555-555555555555";
const turnId = "22222222-2222-4222-8222-222222222222";
const proposalId = "33333333-3333-4333-8333-333333333333";

const openCase = {
  id: proposalId,
  contactEmail: "person@example.com",
  reason: "I need a person",
  orderNumber: "#AB12",
  status: "open" as const,
};

test("POST /api/chat/sessions returns the id and stores the timezone", async () => {
  const runtime = chatRuntime([sessionId, otherSessionId]);

  const named = await createSession(jsonRequest({ timezone: " America/Chicago " }), undefined, runtime);
  const empty = await createSession(jsonRequest({ timezone: "" }), undefined, runtime);

  expect(named.status).toBe(200);
  expect(await named.json()).toEqual({ id: sessionId });
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ id: otherSessionId });
  expect(runtime.sessions.saved()).toEqual([
    {
      id: sessionId,
      localTimezone: { kind: "resolved", name: "America/Chicago" },
      unmatchedOrderStreak: 0,
    },
    {
      id: otherSessionId,
      localTimezone: { kind: "unresolved" },
      unmatchedOrderStreak: 0,
    },
  ]);
});

test("the same turn id and the same text returns the saved reply", async () => {
  const calls = { count: 0 };
  const runtime = await startedRuntime(replyModel(calls, "On the way."));

  const first = await sendMessage(
    jsonRequest({ turnId, text: "where is my order" }),
    sessionContext(sessionId),
    runtime,
  );
  const second = await sendMessage(
    jsonRequest({ turnId, text: "where is my order" }),
    sessionContext(sessionId),
    runtime,
  );

  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ reply: "On the way." });
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual({ reply: "On the way." });
  expect(calls.count).toBe(1);
});

test("the same turn id with different text returns 409", async () => {
  const calls = { count: 0 };
  const runtime = await startedRuntime(replyModel(calls, "On the way."));
  await sendMessage(
    jsonRequest({ turnId, text: "where is my order" }),
    sessionContext(sessionId),
    runtime,
  );

  const conflict = await sendMessage(
    jsonRequest({ turnId, text: "cancel that" }),
    sessionContext(sessionId),
    runtime,
  );

  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ code: "rejected" });
  expect(calls.count).toBe(1);
  expect(runtime.messages.saved()).toEqual([
    customerRow(1, turnId, "where is my order"),
    assistantRow(2, turnId, "On the way."),
  ]);
});

test("a customer row with no assistant row returns 409 already_submitted", async () => {
  const calls = { count: 0 };
  const runtime = await startedRuntime(replyModel(calls, "On the way."));
  await runtime.messages.insert(customerRow(1, turnId, "where is my order"));

  const response = await sendMessage(
    jsonRequest({ turnId, text: "where is my order" }),
    sessionContext(sessionId),
    runtime,
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "already_submitted" });
  expect(calls.count).toBe(0);
  expect(runtime.messages.saved()).toEqual([customerRow(1, turnId, "where is my order")]);
});

test("GET /api/chat/sessions/:id/messages returns the stored messages", async () => {
  const runtime = await startedRuntime(replyModel({ count: 0 }, "On the way."));
  await sendMessage(
    jsonRequest({ turnId, text: "where is my order" }),
    sessionContext(sessionId),
    runtime,
  );

  const response = await readMessages(new Request("http://localhost/messages"), sessionContext(sessionId), runtime);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    messages: [
      customerRow(1, turnId, "where is my order"),
      assistantRow(2, turnId, "On the way."),
    ],
  });
});

test("confirm creates the open case and a later cancel leaves it", async () => {
  const runtime = await startedRuntime(replyModel({ count: 0 }, "On the way."));
  captureHandoff(runtime.proposals, personInput());

  const confirmed = await confirmProposal(
    new Request("http://localhost/confirm", { method: "POST" }),
    handoffContext(sessionId, proposalId),
    runtime,
  );
  const later = await cancelProposal(
    new Request("http://localhost/cancel", { method: "POST" }),
    handoffContext(sessionId, proposalId),
    runtime,
  );

  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toEqual({ decision: "confirmed", supportCase: openCase });
  expect(later.status).toBe(200);
  expect(await later.json()).toEqual({ decision: "confirmed", supportCase: openCase });
  expect(runtime.proposals.cases()).toEqual([openCase]);
});

test("cancel creates no case and a later confirm leaves that decision", async () => {
  const runtime = await startedRuntime(replyModel({ count: 0 }, "On the way."));
  captureHandoff(runtime.proposals, personInput());

  const cancelled = await cancelProposal(
    new Request("http://localhost/cancel", { method: "POST" }),
    handoffContext(sessionId, proposalId),
    runtime,
  );
  const later = await confirmProposal(
    new Request("http://localhost/confirm", { method: "POST" }),
    handoffContext(sessionId, proposalId),
    runtime,
  );

  expect(cancelled.status).toBe(200);
  expect(await cancelled.json()).toEqual({ decision: "cancelled" });
  expect(later.status).toBe(200);
  expect(await later.json()).toEqual({ decision: "cancelled" });
  expect(runtime.proposals.cases()).toEqual([]);
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function handoffContext(id: string, proposal: string) {
  return { params: Promise.resolve({ id, proposalId: proposal }) };
}

async function startedRuntime(model: ScriptedModel): Promise<TestRuntime> {
  const runtime = chatRuntime([sessionId], model);
  const created = await createSession(jsonRequest({}), undefined, runtime);
  expect(created.status).toBe(200);
  return runtime;
}

type TestRuntime = ChatRuntime & {
  sessions: SessionStore & { saved(): readonly Session[] };
  messages: ChatMessageLog & { saved(): readonly TurnMessage[] };
  proposals: ProposalStore & { cases(): SupportCase[] };
};

function chatRuntime(ids: readonly string[], model: ScriptedModel = replyModel({ count: 0 }, "On the way.")): TestRuntime {
  const remaining = [...ids];
  const proposals = fakeProposalStore();
  return {
    sessions: memorySessions(),
    messages: memoryMessages(),
    proposals,
    model,
    dependencies: dependencies(proposals),
    newSessionId() {
      const id = remaining.shift();
      if (id === undefined) throw new Error("test fixture ran out of session ids");
      return id;
    },
  };
}

function replyModel(calls: { count: number }, text: string): ScriptedModel {
  return {
    async complete() {
      calls.count += 1;
      return { text };
    },
  };
}

function personInput() {
  return {
    proposalId,
    sessionId,
    turnId,
    contactEmail: " Person@Example.com ",
    reason: "  I need a person  ",
    orderNumber: "ab12",
  };
}

function customerRow(sequence: number, id: string, content: string): TurnMessage {
  return messageRow(sequence, id, "customer", content);
}

function assistantRow(sequence: number, id: string, content: string): TurnMessage {
  return messageRow(sequence, id, "assistant", content);
}

function messageRow(sequence: number, id: string, role: TurnMessage["role"], content: string): TurnMessage {
  const turn = parseTurn({ id, sessionId, text: content });
  if (!turn.ok) throw new Error("test fixture did not parse");
  return {
    sessionId: turn.value.sessionId,
    turnId: turn.value.id,
    role,
    content,
    sequence,
  };
}

function memorySessions(): SessionStore & { saved(): readonly Session[] } {
  const sessions = new Map<string, Session>();
  return {
    save(session) {
      sessions.set(session.id, session);
    },
    find(id) {
      return sessions.get(id);
    },
    saved() {
      return [...sessions.values()];
    },
  };
}

function memoryMessages(): ChatMessageLog & { saved(): readonly TurnMessage[] } {
  const stored: TurnMessage[] = [];
  const next = new Map<SessionId, number>();
  return {
    async messagesForSession(session) {
      return stored.filter((message) => message.sessionId === session);
    },
    async messagesForTurn(session, turn) {
      return stored.filter((message) => message.sessionId === session && message.turnId === turn);
    },
    async readNextSequence(session) {
      return next.get(session) ?? 1;
    },
    async conditionalUpdate(session, expected): Promise<SequenceUpdate> {
      const current = next.get(session) ?? 1;
      if (current !== expected) return { kind: "unchanged" };
      next.set(session, expected + 1);
      return { kind: "updated", sequence: expected };
    },
    async insert(message) {
      stored.push(message);
    },
    saved() {
      return stored;
    },
  };
}

function fakeProposalStore(): ProposalStore & { cases(): SupportCase[] } {
  const proposals = new Map<string, Proposal>();
  const proposalIdByTurn = new Map<string, string>();
  const cases = new Map<string, SupportCase>();
  return {
    findProposalForTurn(session, turn) {
      const id = proposalIdByTurn.get(`${session}\0${turn}`);
      if (id === undefined) return undefined;
      return proposals.get(id);
    },
    findProposal(id) {
      return proposals.get(id);
    },
    saveProposal(proposal) {
      proposals.set(proposal.id, proposal);
      proposalIdByTurn.set(`${proposal.sessionId}\0${proposal.turnId}`, proposal.id);
    },
    findCase(id) {
      return cases.get(id);
    },
    saveCase(supportCase) {
      cases.set(supportCase.id, supportCase);
    },
    cases() {
      return [...cases.values()];
    },
  };
}

function dependencies(proposals: ProposalStore): SupportTurnDependencies {
  return {
    orders: {
      catalog: {
        async listOrdersForEmail() {
          return { kind: "ready", orders: [] };
        },
      } satisfies OrderCatalog,
      streaks: {
        async read() {
          return { kind: "ready", streak: 0 satisfies UnmatchedOrderStreak };
        },
        async write() {
          return { kind: "ready" };
        },
      } satisfies OrderStreakStore,
    },
    products: {
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
    } satisfies ProductSearchDependencies,
    promotion: {
      session: {
        id: parsed(parse(sessionIdSchema, sessionId)),
        localTimezone: { kind: "unresolved" },
        unmatchedOrderStreak: 0,
      } satisfies Session,
      now: new Date("2026-10-08T00:00:00.000Z"),
      store: {
        async insertOrReuse() {
          throw new Error("claim was not part of this turn");
        },
      } satisfies EarlyRisersCodeStore,
    },
    handoff: {
      store: proposals,
      turnId,
      proposalId,
    },
  };
}

function parsed<T>(result: Parsed<T>): T {
  if (!result.ok) throw new Error("test fixture did not parse");
  return result.value;
}
