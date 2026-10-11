import { expect, test } from "vitest";
import type { Proposal, SupportCase } from "../../../domain/handoff";
import type { SessionId } from "../../../domain/session";
import type { TurnId } from "../../../domain/turn";
import {
  cancelHandoff,
  captureHandoff,
  confirmHandoff,
  type ProposalStore,
} from "./handoff";

const proposalId = "33333333-3333-4333-8333-333333333333";
const otherProposalId = "44444444-4444-4444-8444-444444444444";
const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";

const pendingProposal = {
  decision: "pending" as const,
  id: proposalId,
  sessionId,
  turnId,
  contactEmail: "person@example.com",
  reason: "I need a person",
  orderNumber: "#AB12",
};

const confirmedProposal = {
  decision: "confirmed" as const,
  id: proposalId,
  caseId: proposalId,
  sessionId,
  turnId,
  contactEmail: "person@example.com",
  reason: "I need a person",
  orderNumber: "#AB12",
};

const openCase = {
  id: proposalId,
  contactEmail: "person@example.com",
  reason: "I need a person",
  orderNumber: "#AB12",
  status: "open" as const,
};

const cancelledProposal = {
  decision: "cancelled" as const,
  id: proposalId,
  sessionId,
  turnId,
  contactEmail: "person@example.com",
  reason: "I need a person",
  orderNumber: "#AB12",
};

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

test("captureHandoff stores the first normalized draft", () => {
  const store = fakeProposalStore();

  expect(captureHandoff(store, personInput())).toEqual({
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
  expect(store.proposals()).toEqual([pendingProposal]);
  expect(store.cases()).toEqual([]);
});

test("captureHandoff keeps the first draft when the turn captures again", () => {
  const store = fakeProposalStore();
  captureHandoff(store, personInput());

  expect(
    captureHandoff(store, {
      proposalId: otherProposalId,
      sessionId,
      turnId,
      contactEmail: "other@example.com",
      reason: "A different reason",
      orderNumber: "zz99",
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
  expect(store.proposals()).toEqual([pendingProposal]);
});

test("confirmHandoff opens a case whose id is the proposal id", () => {
  const store = fakeProposalStore();
  captureHandoff(store, personInput());

  expect(confirmHandoff(store, { proposalId })).toEqual({
    decision: "confirmed",
    proposal: confirmedProposal,
    supportCase: openCase,
  });
  expect(store.proposals()).toEqual([confirmedProposal]);
  expect(store.cases()).toEqual([openCase]);
});

test("cancelHandoff marks the proposal cancelled and writes no case", () => {
  const store = fakeProposalStore();
  captureHandoff(store, personInput());

  expect(cancelHandoff(store, { proposalId })).toEqual({
    decision: "cancelled",
    proposal: cancelledProposal,
  });
  expect(store.proposals()).toEqual([cancelledProposal]);
  expect(store.cases()).toEqual([]);
});

test("a second confirm or cancel leaves a confirmed decision", () => {
  const store = fakeProposalStore();
  captureHandoff(store, personInput());
  confirmHandoff(store, { proposalId });

  expect(confirmHandoff(store, { proposalId })).toEqual({
    decision: "confirmed",
    proposal: confirmedProposal,
    supportCase: openCase,
  });
  expect(cancelHandoff(store, { proposalId })).toEqual({
    decision: "confirmed",
    proposal: confirmedProposal,
    supportCase: openCase,
  });
  expect(store.proposals()).toEqual([confirmedProposal]);
  expect(store.cases()).toEqual([openCase]);
});

test("a second cancel or confirm leaves a cancelled decision and no case", () => {
  const store = fakeProposalStore();
  captureHandoff(store, personInput());
  cancelHandoff(store, { proposalId });

  expect(cancelHandoff(store, { proposalId })).toEqual({
    decision: "cancelled",
    proposal: cancelledProposal,
  });
  expect(confirmHandoff(store, { proposalId })).toEqual({
    decision: "cancelled",
    proposal: cancelledProposal,
  });
  expect(store.proposals()).toEqual([cancelledProposal]);
  expect(store.cases()).toEqual([]);
});

function fakeProposalStore(): ProposalStore & {
  proposals(): Proposal[];
  cases(): SupportCase[];
} {
  const proposals = new Map<string, Proposal>();
  const proposalIdByTurn = new Map<string, string>();
  const cases = new Map<string, SupportCase>();

  return {
    listProposals(session: SessionId) {
      return [...proposals.values()].filter((proposal) => proposal.sessionId === session);
    },
    findProposalForTurn(session: SessionId, turn: TurnId) {
      const id = proposalIdByTurn.get(turnKey(session, turn));
      if (id === undefined) {
        return undefined;
      }
      return proposals.get(id);
    },
    findProposal(id: string) {
      return proposals.get(id);
    },
    saveProposal(proposal: Proposal) {
      proposals.set(proposal.id, proposal);
      proposalIdByTurn.set(turnKey(proposal.sessionId, proposal.turnId), proposal.id);
    },
    findCase(id: string) {
      return cases.get(id);
    },
    saveCase(supportCase: SupportCase) {
      cases.set(supportCase.id, supportCase);
    },
    proposals() {
      return [...proposals.values()];
    },
    cases() {
      return [...cases.values()];
    },
  };
}

function turnKey(session: SessionId, turn: TurnId): string {
  return `${session}\0${turn}`;
}
