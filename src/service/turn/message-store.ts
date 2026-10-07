import type { SessionId } from "../../domain/session";
import type { TurnId } from "../../domain/turn";

export type MessageRole = "customer" | "assistant";

export type TurnMessage = {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly role: MessageRole;
  readonly content: string;
  readonly sequence: number;
};

export type SequenceUpdate =
  | { readonly kind: "updated"; readonly sequence: number }
  | { readonly kind: "unchanged" };

export type MessageStore = {
  messagesForTurn(sessionId: SessionId, turnId: TurnId): Promise<readonly TurnMessage[]>;
  readNextSequence(sessionId: SessionId): Promise<number>;
  conditionalUpdate(sessionId: SessionId, expected: number): Promise<SequenceUpdate>;
  insert(message: TurnMessage): Promise<void>;
};
