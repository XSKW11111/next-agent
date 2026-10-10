import { parseTurn, type Turn } from "../../domain/turn";
import { runSupportTurn, type ScriptedModel, type SupportTurnDependencies } from "../agent/support-turn";
import type { MessageStore, TurnMessage } from "./message-store";

export type SubmitTurnResult =
  | { readonly kind: "reply"; readonly reply: string }
  | { readonly kind: "rejected" }
  | { readonly kind: "already_submitted" };

export type SubmitTurnInput = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
  readonly messages: MessageStore;
  readonly model: ScriptedModel;
  readonly dependencies: SupportTurnDependencies;
  readonly maxToolRounds?: number;
  readonly productMatchThreshold?: number;
  readonly maxProductCandidates?: number;
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
      return { kind: "reply", reply: recorded.reply };
    case "submitted":
      return { kind: "already_submitted" };
    case "new":
      return saveNewTurn(input, turn.value);
    default: {
      const unexpected: never = recorded;
      return unexpected;
    }
  }
}

async function saveNewTurn(input: SubmitTurnInput, turn: Turn): Promise<SubmitTurnResult> {
  await insertRow(input.messages, {
    sessionId: turn.sessionId,
    turnId: turn.id,
    role: "customer",
    content: turn.text,
  });

  const completion = await runSupportTurn({
    model: input.model,
    sessionId: turn.sessionId,
    threadId: turn.sessionId,
    customerText: turn.text,
    dependencies: input.dependencies,
    ...(input.maxToolRounds === undefined ? {} : { maxToolRounds: input.maxToolRounds }),
    ...(input.productMatchThreshold === undefined
      ? {}
      : { productMatchThreshold: input.productMatchThreshold }),
    ...(input.maxProductCandidates === undefined
      ? {}
      : { maxProductCandidates: input.maxProductCandidates }),
  });

  await insertRow(input.messages, {
    sessionId: turn.sessionId,
    turnId: turn.id,
    role: "assistant",
    content: completion.draft,
  });

  return { kind: "reply", reply: completion.draft };
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
