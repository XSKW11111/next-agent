import type { TurnId } from "../../domain/turn";
import type { TurnMessage } from "./message-store";

export type StoredSupportMessage =
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls: readonly [];
    };

export function priorSupportMessages(
  rows: readonly TurnMessage[],
  turnId: TurnId,
): readonly StoredSupportMessage[] {
  const sorted = [...rows].sort((left, right) => left.sequence - right.sequence);
  const answeredTurnIds = new Set<TurnId>();
  for (const row of sorted) {
    if (row.turnId !== turnId && row.role === "assistant") answeredTurnIds.add(row.turnId);
  }
  return sorted
    .filter((row) => row.turnId !== turnId && answeredTurnIds.has(row.turnId))
    .map(toStoredSupportMessage);
}

function toStoredSupportMessage(row: TurnMessage): StoredSupportMessage {
  switch (row.role) {
    case "customer":
      return { role: "user", content: row.content };
    case "assistant":
      return { role: "assistant", content: row.content, toolCalls: [] };
    default: {
      const unexpected: never = row.role;
      return unexpected;
    }
  }
}
