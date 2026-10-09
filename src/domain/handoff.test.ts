import { expect, test } from "vitest";
import { parseCase, parseHandoffResult, parseProposal, type ContactEmail } from "./handoff";
import type { OrderEmail } from "./order";

type Distinct<A, B> = [A] extends [B] ? ([B] extends [A] ? false : true) : true;

function assertDistinct<A, B>(
  ...args: Distinct<A, B> extends true ? [] : [never]
): void {
  void args;
}

assertDistinct<OrderEmail, ContactEmail>();

const proposalId = "33333333-3333-4333-8333-333333333333";
const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";

test("parseHandoffResult accepts a proposal draft", () => {
  expect(
    parseHandoffResult({
      kind: "handoff_proposed",
      draft: {
        contactEmail: " Person@Example.com ",
        reason: "  I need a person  ",
        orderNumber: "ab12",
      },
    }),
  ).toEqual({
    ok: true,
    value: {
      kind: "handoff_proposed",
      draft: {
        contactEmail: "person@example.com",
        reason: "I need a person",
        orderNumber: "#AB12",
      },
    },
  });
});

test("parseHandoffResult rejects a case", () => {
  expect(
    parseHandoffResult({
      kind: "handoff_proposed",
      status: "open",
      draft: {
        contactEmail: "person@example.com",
        reason: "I need a person",
      },
    }),
  ).toEqual({ ok: false });
});

test("parseProposal accepts a confirmed proposal whose case id is the proposal id", () => {
  expect(
    parseProposal({
      decision: "confirmed",
      id: proposalId,
      caseId: proposalId,
      sessionId,
      turnId,
      contactEmail: "person@example.com",
      reason: "I need a person",
    }),
  ).toEqual({
    ok: true,
    value: {
      decision: "confirmed",
      id: proposalId,
      caseId: proposalId,
      sessionId,
      turnId,
      contactEmail: "person@example.com",
      reason: "I need a person",
    },
  });
});

test("parseProposal rejects cancel when a case id is attached", () => {
  expect(
    parseProposal({
      decision: "cancelled",
      id: proposalId,
      caseId: proposalId,
      sessionId,
      turnId,
      contactEmail: "person@example.com",
      reason: "I need a person",
    }),
  ).toEqual({ ok: false });
});

test("parseProposal rejects a confirmed proposal with a different case id", () => {
  expect(
    parseProposal({
      decision: "confirmed",
      id: proposalId,
      caseId: "44444444-4444-4444-8444-444444444444",
      sessionId,
      turnId,
      contactEmail: "person@example.com",
      reason: "I need a person",
    }),
  ).toEqual({ ok: false });
});

test("parseCase accepts an open case and rejects a proposal", () => {
  expect(
    parseCase({
      id: proposalId,
      contactEmail: "person@example.com",
      reason: "I need a person",
      status: "open",
    }),
  ).toEqual({
    ok: true,
    value: {
      id: proposalId,
      contactEmail: "person@example.com",
      reason: "I need a person",
      status: "open",
    },
  });
  expect(
    parseCase({
      decision: "pending",
      id: proposalId,
      sessionId,
      turnId,
      contactEmail: "person@example.com",
      reason: "I need a person",
    }),
  ).toEqual({ ok: false });
});
