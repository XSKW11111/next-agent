import type { HandoffPart } from "../../domain/handoff";
import { parseTurn, type Turn } from "../../domain/turn";
import { runSupportTurn, type ScriptedModel, type SupportTurnDependencies } from "../agent/support-turn";
import type { MessageStore, TurnMessage } from "./message-store";

export type SubmitTurnResult =
  | { readonly kind: "reply"; readonly reply: string; readonly handoff?: HandoffPart }
  | { readonly kind: "rejected" }
  | { readonly kind: "already_submitted" };

export type SubmitTurnInput = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
  readonly messages: MessageStore;
  readonly model: ScriptedModel;
  readonly dependencies: SupportTurnDependencies;
};

type RecordedTurn =
  | { readonly kind: "new" }
  | { readonly kind: "submitted" }
  | { readonly kind: "saved"; readonly text: string; readonly reply: string };

export async function submitTurn(input: SubmitTurnInput): Promise<SubmitTurnResult> {
  const turn = parseTurn({
    id: input.turnId,
    sessionId: input.sessionId,
    text: input.text,
  });
  if (!turn.ok) {
    throw new Error("turn is invalid");
  }

  const recorded = recordTurn(await input.messages.messagesForTurn(turn.value.sessionId, turn.value.id));
  switch (recorded.kind) {
    case "saved":
      if (recorded.text !== turn.value.text) return { kind: "rejected" };
      return replyResult(recorded.reply, input.dependencies, turn.value);
    case "submitted":
      return { kind: "already_submitted" };
    case "new":
      return saveNewTurn(input.messages, input.model, input.dependencies, turn.value);
    default: {
      const unexpected: never = recorded;
      return unexpected;
    }
  }
}

async function saveNewTurn(
  messages: MessageStore,
  model: ScriptedModel,
  dependencies: SupportTurnDependencies,
  turn: Turn,
): Promise<SubmitTurnResult> {
  await insertRow(messages, {
    sessionId: turn.sessionId,
    turnId: turn.id,
    role: "customer",
    content: turn.text,
  });

  const completion = await runSupportTurn({
    model,
    sessionId: turn.sessionId,
    threadId: turn.sessionId,
    customerText: turn.text,
    dependencies,
  });

  await insertRow(messages, {
    sessionId: turn.sessionId,
    turnId: turn.id,
    role: "assistant",
    content: completion.draft,
  });

  return replyResult(completion.draft, dependencies, turn);
}

function replyResult(
  reply: string,
  dependencies: SupportTurnDependencies,
  turn: Turn,
): SubmitTurnResult {
  const proposal = dependencies.handoff.store.findProposalForTurn(turn.sessionId, turn.id);
  if (proposal === undefined) return { kind: "reply", reply };
  return {
    kind: "reply",
    reply,
    handoff: { proposalId: proposal.id, decision: proposal.decision },
  };
}

async function insertRow(
  messages: MessageStore,
  row: Omit<TurnMessage, "sequence">,
): Promise<void> {
  const sequence = await takeSequence(messages, row.sessionId);
  await messages.insert({ ...row, sequence });
}

async function takeSequence(messages: MessageStore, sessionId: TurnMessage["sessionId"]): Promise<number> {
  const claimed = await claimSequence(messages, sessionId);
  if (claimed !== undefined) return claimed;
  const retried = await claimSequence(messages, sessionId);
  if (retried !== undefined) return retried;
  throw new Error("next message sequence is contested");
}

async function claimSequence(
  messages: MessageStore,
  sessionId: TurnMessage["sessionId"],
): Promise<number | undefined> {
  const expected = await messages.readNextSequence(sessionId);
  const updated = await messages.conditionalUpdate(sessionId, expected);
  switch (updated.kind) {
    case "updated":
      return updated.sequence;
    case "unchanged":
      return undefined;
    default: {
      const unexpected: never = updated;
      return unexpected;
    }
  }
}

function recordTurn(messages: readonly TurnMessage[]): RecordedTurn {
  let customer: TurnMessage | undefined;
  let assistant: TurnMessage | undefined;
  for (const message of messages) {
    switch (message.role) {
      case "customer":
        customer ??= message;
        break;
      case "assistant":
        assistant ??= message;
        break;
      default: {
        const unexpected: never = message.role;
        return unexpected;
      }
    }
  }
  if (customer !== undefined && assistant !== undefined) {
    return { kind: "saved", text: customer.content, reply: assistant.content };
  }
  if (customer !== undefined || assistant !== undefined) return { kind: "submitted" };
  return { kind: "new" };
}
