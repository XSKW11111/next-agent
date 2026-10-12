import { expect, test } from "vitest";
import type { Proposal, SupportCase } from "../../domain/handoff";
import { orderNumberSchema } from "../../domain/order";
import { parseSession, type SessionId } from "../../domain/session";
import type { ScriptedModel, SupportTurnDependencies } from "../agent/support-turn";
import { confirmHandoff, type ProposalStore } from "../business/handoff/handoff";
import type { OrderCatalog, OrderStreakStore } from "../business/order/lookup-order";
import type { EarlyRisersCodeStore } from "../business/promotion/claim-early-risers";
import type { ProductSearchDependencies } from "../business/product/search-products";
import { gradeCase } from "../eval/grade-case";
import type { MessageStore, SequenceUpdate, TurnMessage } from "../turn/message-store";
import { submitTurn } from "../turn/submit-turn";

const sessionId = "11111111-1111-4111-8111-111111111111";
const orderTurnId = "22222222-2222-4222-8222-222222222222";
const handoffTurnId = "33333333-3333-4333-8333-333333333333";
const otherTurnId = "55555555-5555-4555-8555-555555555555";
const proposalId = "44444444-4444-4444-8444-444444444444";
const shippedReply =
  "Your order #W002 shipped. Track it at https://track.example/TRK987654321";

test("an order answer is saved, and the same turn id returns that reply", async () => {
  const messages = memoryMessages();
  const calls = { count: 0 };
  const lookups = { count: 0 };

  const first = await submitTurn({
    sessionId,
    turnId: orderTurnId,
    text: "where is order W002",
    messages,
    model: orderModel(calls),
    dependencies: dependencies(lookups, memoryProposals()),
  });
  const second = await submitTurn({
    sessionId,
    turnId: orderTurnId,
    text: "where is order W002",
    messages,
    model: orderModel(calls),
    dependencies: dependencies(lookups, memoryProposals()),
  });

  expect(first).toEqual({ kind: "reply", reply: shippedReply });
  expect(second).toEqual({ kind: "reply", reply: shippedReply });
  if (first.kind !== "reply") throw new Error("order answer was not a reply");
  expect(gradeCase("order-found", { reply: first.reply })).toBe(true);
  expect(calls.count).toBe(2);
  expect(lookups.count).toBe(1);
});

test("a handoff proposal can be confirmed into an open case", async () => {
  const messages = memoryMessages();
  const store = memoryProposals();
  const reply = "Please choose Confirm or Cancel.";

  const result = await submitTurn({
    sessionId,
    turnId: handoffTurnId,
    text: "I need a person at person@example.com",
    messages,
    model: handoffModel(reply),
    dependencies: dependencies({ count: 0 }, store),
  });

  expect(result).toEqual({ kind: "reply", reply });
  expect(gradeCase("handoff-propose", { reply })).toBe(true);
  expect(confirmHandoff(store, { proposalId })).toEqual({
    decision: "confirmed",
    proposal: {
      decision: "confirmed",
      id: proposalId,
      caseId: proposalId,
      sessionId,
      turnId: handoffTurnId,
      contactEmail: "person@example.com",
      reason: "I need a person",
    },
    supportCase: {
      id: proposalId,
      contactEmail: "person@example.com",
      reason: "I need a person",
      status: "open",
    },
  });
});

test("two turns in flight each keep their own reply", async () => {
  const messages = memoryMessages();
  const model: ScriptedModel = {
    async complete(input) {
      const latest = input.messages.at(-1);
      const text = latest?.role === "user" ? latest.content : "";
      return { text: `reply:${text}` };
    },
  };
  const ports = dependencies({ count: 0 }, memoryProposals());

  const [first, second] = await Promise.all([
    submitTurn({
      sessionId,
      turnId: orderTurnId,
      text: "first order",
      messages,
      model,
      dependencies: ports,
    }),
    submitTurn({
      sessionId,
      turnId: otherTurnId,
      text: "second order",
      messages,
      model,
      dependencies: ports,
    }),
  ]);

  expect(first).toEqual({ kind: "reply", reply: "reply:first order" });
  expect(second).toEqual({ kind: "reply", reply: "reply:second order" });
});

function orderModel(calls: { count: number }): ScriptedModel {
  return {
    async complete(input) {
      calls.count += 1;
      const sawTool = input.messages.some((message) => message.role === "tool");
      if (!sawTool) {
        return {
          text: "Looking up the order.",
          toolCalls: [
            {
              id: "lookup-1",
              name: "lookup_order",
              args: { email: "jane.smith@example.com", order_number: "W002" },
            },
          ],
        };
      }
      return { text: shippedReply };
    },
  };
}

function handoffModel(reply: string): ScriptedModel {
  return {
    async complete(input) {
      const sawTool = input.messages.some((message) => message.role === "tool");
      if (!sawTool) {
        return {
          text: "Preparing a person.",
          toolCalls: [
            {
              id: "handoff-1",
              name: "capture_handoff",
              args: {
                contact_email: "person@example.com",
                reason: "I need a person",
              },
            },
          ],
        };
      }
      return { text: reply };
    },
  };
}

function memoryMessages(): MessageStore {
  const stored: TurnMessage[] = [];
  const next = new Map<SessionId, number>();
  return {
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
  };
}

function memoryProposals(): ProposalStore {
  const proposals = new Map<string, Proposal>();
  const proposalIdByTurn = new Map<string, string>();
  const cases = new Map<string, SupportCase>();
  return {
    listProposals(session) {
      return [...proposals.values()].filter((proposal) => proposal.sessionId === session);
    },
    findProposalForTurn(session, turn) {
      const id = proposalIdByTurn.get(`${session}\0${turn}`);
      return id === undefined ? undefined : proposals.get(id);
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
  };
}

function dependencies(lookups: { count: number }, store: ProposalStore): SupportTurnDependencies {
  const session = parseSession({
    id: sessionId,
    localTimezone: { kind: "unresolved" },
    unmatchedOrderStreak: 0,
  });
  if (!session.ok) throw new Error("session fixture did not parse");
  return {
    orders: {
      catalog: {
        async listOrdersForEmail() {
          lookups.count += 1;
          return {
            kind: "ready",
            orders: [
              {
                orderNumber: orderNumberSchema.parse("W002"),
                status: "shipped",
                trackingNumber: "TRK987654321",
              },
            ],
          };
        },
      } satisfies OrderCatalog,
      streaks: {
        async read() {
          return { kind: "ready", streak: 0 };
        },
        async write() {
          return { kind: "ready" };
        },
      } satisfies OrderStreakStore,
    },
    products: unusedProducts(),
    promotion: {
      session: session.value,
      now: new Date("2026-10-08T01:00:00.000Z"),
      store: {
        async insertOrReuse() {
          throw new Error("claim was not part of this walk");
        },
      } satisfies EarlyRisersCodeStore,
    },
    handoff: {
      store,
      turnId: handoffTurnId,
      proposalId,
    },
  };
}

function unusedProducts(): ProductSearchDependencies {
  return {
    catalog: {
      async matchProducts() {
        throw new Error("search was not part of this walk");
      },
      async listProducts() {
        throw new Error("search was not part of this walk");
      },
    },
    embedder: {
      async embed() {
        throw new Error("search was not part of this walk");
      },
    },
  };
}
