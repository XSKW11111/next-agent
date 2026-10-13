import { expect, test } from "vitest";
import { parseTurn, type TurnId } from "../../domain/turn";
import type { TurnMessage } from "./message-store";
import { priorSupportMessages } from "./prior-messages";

const sessionId = "11111111-1111-4111-8111-111111111111";
const currentTurnId = "22222222-2222-4222-8222-222222222222";
const firstTurnId = "33333333-3333-4333-8333-333333333333";
const secondTurnId = "44444444-4444-4444-8444-444444444444";
const inflightTurnId = "55555555-5555-4555-8555-555555555555";

test("prior support messages recall completed turns in sequence and skip the current turn and an in-flight sibling", () => {
  const messages = priorSupportMessages(
    [
      row(4, secondTurnId, "assistant", "Second answer."),
      row(1, firstTurnId, "customer", "First question."),
      row(5, inflightTurnId, "customer", "Still writing."),
      row(6, currentTurnId, "customer", "Current question."),
      row(3, secondTurnId, "customer", "Second question."),
      row(2, firstTurnId, "assistant", "First answer."),
      row(7, currentTurnId, "assistant", "Current answer."),
    ],
    turnId(currentTurnId),
  );

  expect(messages).toEqual([
    { role: "user", content: "First question." },
    { role: "assistant", content: "First answer.", toolCalls: [] },
    { role: "user", content: "Second question." },
    { role: "assistant", content: "Second answer.", toolCalls: [] },
  ]);
});

test("a stored summary hides the covered turns and keeps the later raw turns", () => {
  const messages = priorSupportMessages(
    [
      row(1, firstTurnId, "customer", "First question."),
      row(2, firstTurnId, "assistant", "First answer."),
      row(2, firstTurnId, "summary", "Earlier turns."),
      row(3, secondTurnId, "customer", "Second question."),
      row(4, secondTurnId, "assistant", "Second answer."),
    ],
    turnId(currentTurnId),
  );

  expect(messages).toEqual([
    { role: "user", content: "Second question." },
    { role: "assistant", content: "Second answer.", toolCalls: [] },
  ]);
});

function turnId(id: string): TurnId {
  const turn = parseTurn({ id, sessionId, text: "fixture" });
  if (!turn.ok) throw new Error("test fixture did not parse");
  return turn.value.id;
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
