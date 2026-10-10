import { expect, test } from "vitest";
import { parse, type Parsed } from "../../domain/parse";
import { sessionIdSchema, type Session, type SessionId, type UnmatchedOrderStreak } from "../../domain/session";
import { parseTurn } from "../../domain/turn";
import type { ProposalStore } from "../handoff/handoff";
import type { OrderCatalog, OrderStreakStore } from "../order/lookup-order";
import type { ProductSearchDependencies } from "../product/search-products";
import type { EarlyRisersCodeStore } from "../promotion/claim-early-risers";
import type { ScriptedModel, SupportTurnDependencies } from "../agent/support-turn";
import type { MessageStore, SequenceUpdate, TurnMessage } from "./message-store";
import { submitTurn } from "./submit-turn";

const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const otherTurnId = "33333333-3333-4333-8333-333333333333";
const filteredDraft = "Something was wrong with the model output, Please try again";

test("the same turn id and the same text returns the saved reply", async () => {
  const messages = memoryMessages();
  const calls = { count: 0 };
  const input = {
    sessionId,
    turnId,
    text: "  where is my order  ",
    messages,
    model: replyModel(calls, "On the way."),
    dependencies: dependencies(),
  };

  const first = await submitTurn(input);
  const second = await submitTurn(input);

  expect(first).toEqual({ kind: "reply", reply: "On the way." });
  expect(second).toEqual({ kind: "reply", reply: "On the way." });
  expect(calls.count).toBe(1);
  expect(messages.rows()).toEqual([
    customerRow(1, turnId, "where is my order"),
    assistantRow(2, turnId, "On the way."),
  ]);
});

test("the same turn id with different text is rejected", async () => {
  const messages = memoryMessages();
  const calls = { count: 0 };
  const model = replyModel(calls, "On the way.");
  await submitTurn({
    sessionId,
    turnId,
    text: "where is my order",
    messages,
    model,
    dependencies: dependencies(),
  });

  const rejected = await submitTurn({
    sessionId,
    turnId,
    text: "cancel that",
    messages,
    model,
    dependencies: dependencies(),
  });

  expect(rejected).toEqual({ kind: "rejected" });
  expect(calls.count).toBe(1);
  expect(messages.rows()).toEqual([
    customerRow(1, turnId, "where is my order"),
    assistantRow(2, turnId, "On the way."),
  ]);
});

test("a customer row with no assistant row is already submitted", async () => {
  const messages = memoryMessages();
  await messages.insert(customerRow(1, turnId, "where is my order"));
  const calls = { count: 0 };

  const result = await submitTurn({
    sessionId,
    turnId,
    text: "where is my order",
    messages,
    model: replyModel(calls, "On the way."),
    dependencies: dependencies(),
  });

  expect(result).toEqual({ kind: "already_submitted" });
  expect(calls.count).toBe(0);
  expect(messages.rows()).toEqual([customerRow(1, turnId, "where is my order")]);
});

test("a new turn stores the customer row and the assistant draft", async () => {
  const messages = memoryMessages();
  const calls = { count: 0 };

  const result = await submitTurn({
    sessionId,
    turnId,
    text: "where is my order",
    messages,
    model: replyModel(calls, "The database stored it."),
    dependencies: dependencies(),
  });

  expect(result).toEqual({ kind: "reply", reply: filteredDraft });
  expect(calls.count).toBe(1);
  expect(messages.rows()).toEqual([
    customerRow(1, turnId, "where is my order"),
    assistantRow(2, turnId, filteredDraft),
  ]);
});

test("two turn ids store both replies", async () => {
  const messages = memoryMessages();
  const calls = { count: 0 };
  const model: ScriptedModel = {
    async complete(input) {
      calls.count += 1;
      const latest = input.messages.at(-1);
      const text = latest?.role === "user" ? latest.content : "";
      return { text: `reply:${text}` };
    },
  };

  const [first, second] = await Promise.all([
    submitTurn({
      sessionId,
      turnId,
      text: "first order",
      messages,
      model,
      dependencies: dependencies(),
    }),
    submitTurn({
      sessionId,
      turnId: otherTurnId,
      text: "second order",
      messages,
      model,
      dependencies: dependencies(),
    }),
  ]);

  expect(first).toEqual({ kind: "reply", reply: "reply:first order" });
  expect(second).toEqual({ kind: "reply", reply: "reply:second order" });
  expect(calls.count).toBe(2);
  expect(turnRows(messages, turnId)).toEqual([
    ["customer", "first order"],
    ["assistant", "reply:first order"],
  ]);
  expect(turnRows(messages, otherTurnId)).toEqual([
    ["customer", "second order"],
    ["assistant", "reply:second order"],
  ]);
  expect(messages.rows().map((row) => row.sequence).sort((left, right) => left - right)).toEqual([
    1, 2, 3, 4,
  ]);
});

test("a lost sequence claim retries once and stores the draft", async () => {
  const messages = memoryMessages({ unchangedClaims: 1 });
  const calls = { count: 0 };

  const result = await submitTurn({
    sessionId,
    turnId,
    text: "where is my order",
    messages,
    model: replyModel(calls, "On the way."),
    dependencies: dependencies(),
  });

  expect(result).toEqual({ kind: "reply", reply: "On the way." });
  expect(calls.count).toBe(1);
  expect(messages.rows()).toEqual([
    customerRow(1, turnId, "where is my order"),
    assistantRow(2, turnId, "On the way."),
  ]);
});

test("maxToolRounds from the caller stops the model after that many completions", async () => {
  const messages = memoryMessages();
  const calls = { count: 0 };
  const model: ScriptedModel = {
    async complete() {
      calls.count += 1;
      return {
        text: "Looking it up.",
        toolCalls: [{ id: "lookup-1", name: "lookup_order", args: { email: "ada@example.com" } }],
      };
    },
  };

  const result = await submitTurn({
    sessionId,
    turnId,
    text: "where is my order",
    messages,
    model,
    dependencies: dependencies(),
    maxToolRounds: 1,
  });

  expect(calls.count).toBe(1);
  expect(result).toEqual({ kind: "reply", reply: "Looking it up." });
});

test("a second lost sequence claim stores nothing and skips the model", async () => {
  const messages = memoryMessages({ unchangedClaims: 2 });
  const calls = { count: 0 };

  await expect(
    submitTurn({
      sessionId,
      turnId,
      text: "where is my order",
      messages,
      model: replyModel(calls, "On the way."),
      dependencies: dependencies(),
    }),
  ).rejects.toThrow("next message sequence is contested");
  expect(calls.count).toBe(0);
  expect(messages.rows()).toEqual([]);
});

function replyModel(calls: { count: number }, text: string): ScriptedModel {
  return {
    async complete() {
      calls.count += 1;
      return { text };
    },
  };
}

function customerRow(sequence: number, id: string, content: string): TurnMessage {
  return row(sequence, id, "customer", content);
}

function assistantRow(sequence: number, id: string, content: string): TurnMessage {
  return row(sequence, id, "assistant", content);
}

function row(sequence: number, id: string, role: TurnMessage["role"], content: string): TurnMessage {
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

function memoryMessages(options?: { readonly unchangedClaims?: number }): MessageStore & {
  rows(): readonly TurnMessage[];
} {
  const stored: TurnMessage[] = [];
  const next = new Map<SessionId, number>();
  let unchangedClaims = options?.unchangedClaims ?? 0;
  return {
    async messagesForTurn(session, turn) {
      return stored.filter((message) => message.sessionId === session && message.turnId === turn);
    },
    async readNextSequence(session) {
      return next.get(session) ?? 1;
    },
    async conditionalUpdate(session, expected): Promise<SequenceUpdate> {
      if (unchangedClaims > 0) {
        unchangedClaims -= 1;
        return { kind: "unchanged" };
      }
      const current = next.get(session) ?? 1;
      if (current !== expected) return { kind: "unchanged" };
      next.set(session, expected + 1);
      return { kind: "updated", sequence: expected };
    },
    async insert(message) {
      stored.push(message);
    },
    rows() {
      return stored;
    },
  };
}

function dependencies(): SupportTurnDependencies {
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
      store: {
        findProposalForTurn() {
          return undefined;
        },
        findProposal() {
          return undefined;
        },
        saveProposal() {},
        findCase() {
          return undefined;
        },
        saveCase() {},
      } satisfies ProposalStore,
      turnId,
      proposalId: "44444444-4444-4444-8444-444444444444",
    },
  };
}

function turnRows(messages: { rows(): readonly TurnMessage[] }, id: string) {
  return messages
    .rows()
    .filter((row) => row.turnId === id)
    .map((row) => [row.role, row.content]);
}

function parsed<T>(result: Parsed<T>): T {
  if (!result.ok) throw new Error("test fixture did not parse");
  return result.value;
}
