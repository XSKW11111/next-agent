import {
  parseCase,
  parseHandoffResult,
  parseProposal,
  type HandoffResult,
  type Proposal,
  type SupportCase,
} from "../../domain/handoff";
import type { Parsed } from "../../domain/parse";
import { sessionIdSchema, type SessionId } from "../../domain/session";
import { turnIdSchema, type TurnId } from "../../domain/turn";

export type ProposalStore = {
  findProposalForTurn(sessionId: SessionId, turnId: TurnId): Proposal | undefined;
  findProposal(id: string): Proposal | undefined;
  saveProposal(proposal: Proposal): void;
  findCase(id: string): SupportCase | undefined;
  saveCase(supportCase: SupportCase): void;
};

export type CaptureHandoffInput = {
  readonly proposalId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly contactEmail: string;
  readonly reason: string;
  readonly orderNumber?: string;
};

export type HandoffDecision =
  | {
      readonly decision: "confirmed";
      readonly proposal: Extract<Proposal, { decision: "confirmed" }>;
      readonly supportCase: SupportCase;
    }
  | {
      readonly decision: "cancelled";
      readonly proposal: Extract<Proposal, { decision: "cancelled" }>;
    }
  | { readonly decision: "missing" };

type HandoffCommand = "confirm" | "cancel";

export function captureHandoff(
  store: ProposalStore,
  input: CaptureHandoffInput,
): Parsed<HandoffResult> {
  const sessionId = sessionIdSchema.safeParse(input.sessionId);
  const turnId = turnIdSchema.safeParse(input.turnId);
  if (!sessionId.success || !turnId.success) {
    return { ok: false };
  }

  const existing = store.findProposalForTurn(sessionId.data, turnId.data);
  if (existing !== undefined) {
    return { ok: true, value: handoffResult(existing) };
  }

  const parsed = parseHandoffResult({
    kind: "handoff_proposed",
    draft: {
      contactEmail: input.contactEmail,
      reason: input.reason,
      ...orderField(input.orderNumber),
    },
  });
  if (!parsed.ok) {
    return parsed;
  }

  const proposal = parseProposal({
    decision: "pending",
    id: input.proposalId,
    sessionId: sessionId.data,
    turnId: turnId.data,
    contactEmail: parsed.value.draft.contactEmail,
    reason: parsed.value.draft.reason,
    ...orderField(parsed.value.draft.orderNumber),
  });
  if (!proposal.ok) {
    return { ok: false };
  }

  store.saveProposal(proposal.value);
  return parsed;
}

export function confirmHandoff(
  store: ProposalStore,
  input: { readonly proposalId: string },
): HandoffDecision {
  return decide(store, input.proposalId, "confirm");
}

export function cancelHandoff(
  store: ProposalStore,
  input: { readonly proposalId: string },
): HandoffDecision {
  return decide(store, input.proposalId, "cancel");
}

function decide(
  store: ProposalStore,
  proposalId: string,
  command: HandoffCommand,
): HandoffDecision {
  const proposal = store.findProposal(proposalId);
  if (proposal === undefined) {
    return { decision: "missing" };
  }

  switch (proposal.decision) {
    case "confirmed":
      return confirmedDecision(store, proposal);
    case "cancelled":
      return { decision: "cancelled", proposal };
    case "pending":
      switch (command) {
        case "confirm":
          return confirmPending(store, proposal);
        case "cancel":
          return cancelPending(store, proposal);
        default: {
          const exhaustive: never = command;
          return exhaustive;
        }
      }
    default: {
      const exhaustive: never = proposal;
      return exhaustive;
    }
  }
}

function confirmPending(
  store: ProposalStore,
  proposal: Extract<Proposal, { decision: "pending" }>,
): HandoffDecision {
  const supportCase = parseCase({
    id: proposal.id,
    status: "open",
    ...draftFields(proposal),
  });
  const confirmed = parseProposal({
    decision: "confirmed",
    caseId: proposal.id,
    ...identityFields(proposal),
  });
  if (!supportCase.ok || !confirmed.ok) {
    throw new Error("Handoff confirm did not match the domain");
  }

  switch (confirmed.value.decision) {
    case "confirmed":
      store.saveCase(supportCase.value);
      store.saveProposal(confirmed.value);
      return {
        decision: "confirmed",
        proposal: confirmed.value,
        supportCase: supportCase.value,
      };
    case "pending":
    case "cancelled":
      throw new Error("Handoff confirm did not match the domain");
    default: {
      const exhaustive: never = confirmed.value;
      return exhaustive;
    }
  }
}

function cancelPending(
  store: ProposalStore,
  proposal: Extract<Proposal, { decision: "pending" }>,
): HandoffDecision {
  const cancelled = parseProposal({
    decision: "cancelled",
    ...identityFields(proposal),
  });
  if (!cancelled.ok) {
    throw new Error("Handoff cancel did not match the domain");
  }

  switch (cancelled.value.decision) {
    case "cancelled":
      store.saveProposal(cancelled.value);
      return { decision: "cancelled", proposal: cancelled.value };
    case "pending":
    case "confirmed":
      throw new Error("Handoff cancel did not match the domain");
    default: {
      const exhaustive: never = cancelled.value;
      return exhaustive;
    }
  }
}

function confirmedDecision(
  store: ProposalStore,
  proposal: Extract<Proposal, { decision: "confirmed" }>,
): HandoffDecision {
  const supportCase = store.findCase(proposal.caseId);
  if (supportCase === undefined) {
    throw new Error("Confirmed proposal has no case");
  }
  return { decision: "confirmed", proposal, supportCase };
}

function handoffResult(proposal: Proposal): HandoffResult {
  return {
    kind: "handoff_proposed",
    draft: draftFields(proposal),
  };
}

function identityFields(proposal: Proposal) {
  return {
    id: proposal.id,
    sessionId: proposal.sessionId,
    turnId: proposal.turnId,
    ...draftFields(proposal),
  };
}

function draftFields(proposal: Proposal): HandoffResult["draft"] {
  const draft = {
    contactEmail: proposal.contactEmail,
    reason: proposal.reason,
  };
  if (proposal.orderNumber === undefined) {
    return draft;
  }
  return { ...draft, orderNumber: proposal.orderNumber };
}

function orderField(orderNumber: string | undefined): { orderNumber: string } | Record<string, never> {
  if (orderNumber === undefined) {
    return {};
  }
  return { orderNumber };
}
