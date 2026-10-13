import type { TurnId } from "../../domain/turn";
import type { TurnMessage } from "./message-store";

export type StoredSupportMessage =
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls: readonly [];
    };

export type PriorContext = {
  readonly summary: string | null;
  readonly coveredThrough: number;
  readonly messages: readonly StoredSupportMessage[];
  readonly sequences: readonly number[];
};

export function priorSupportMessages(
  rows: readonly TurnMessage[],
  turnId: TurnId,
): readonly StoredSupportMessage[] {
  return priorContext(rows, turnId).messages;
}

export function priorContext(rows: readonly TurnMessage[], turnId: TurnId): PriorContext {
  const sorted = [...rows].sort((left, right) => left.sequence - right.sequence);
  const covered = latestSummary(sorted);
  const answeredTurnIds = new Set<TurnId>();
  for (const row of sorted) {
    if (row.turnId !== turnId && row.role === "assistant") answeredTurnIds.add(row.turnId);
  }
  const kept = sorted.filter(
    (row): row is TurnMessage & { readonly role: "customer" | "assistant" } =>
      row.role !== "summary" &&
      row.sequence > covered.coveredThrough &&
      row.turnId !== turnId &&
      answeredTurnIds.has(row.turnId),
  );
  return {
    summary: covered.summary,
    coveredThrough: covered.coveredThrough,
    messages: kept.map(toStoredSupportMessage),
    sequences: kept.map((row) => row.sequence),
  };
}

function latestSummary(rows: readonly TurnMessage[]): { readonly summary: string | null; readonly coveredThrough: number } {
  let summary: string | null = null;
  let coveredThrough = 0;
  for (const row of rows) {
    if (row.role === "summary" && row.sequence >= coveredThrough) {
      summary = row.content;
      coveredThrough = row.sequence;
    }
  }
  return { summary, coveredThrough };
}

function toStoredSupportMessage(
  row: TurnMessage & { readonly role: "customer" | "assistant" },
): StoredSupportMessage {
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
