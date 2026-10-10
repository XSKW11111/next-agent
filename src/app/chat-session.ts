import type { UIMessage } from "ai";
import { z } from "zod";
import type { HandoffPart } from "../domain/handoff";

export const sessionStorageKey = "next-agent.session-id";

const sessionIdSchema = z.uuid();

const storedMessageSchema = z.strictObject({
  role: z.enum(["customer", "assistant"]),
  content: z.string(),
  sequence: z.number().int(),
  turnId: z.uuid(),
  sessionId: z.uuid(),
});

const storedProposalSchema = z.strictObject({
  turnId: z.uuid(),
  proposalId: z.uuid(),
  decision: z.enum(["pending", "confirmed", "cancelled"]),
});

export const supportHistorySchema = z.strictObject({
  messages: z.array(storedMessageSchema),
  proposals: z.array(storedProposalSchema),
});

export function supportMessages(
  rows: readonly z.infer<typeof storedMessageSchema>[],
  proposals: readonly z.infer<typeof storedProposalSchema>[] = [],
): UIMessage[] {
  const proposalByTurn = new Map(proposals.map((proposal) => [proposal.turnId, proposal]));
  return [...rows]
    .sort((left, right) => left.sequence - right.sequence)
    .map((row) => ({
      id: `${row.turnId}:${row.role}`,
      role: row.role === "customer" ? "user" : "assistant",
      parts: messageParts(row, proposalByTurn.get(row.turnId)),
    }));
}

function messageParts(
  row: z.infer<typeof storedMessageSchema>,
  proposal: z.infer<typeof storedProposalSchema> | undefined,
): UIMessage["parts"] {
  const text = { type: "text" as const, text: row.content };
  if (row.role !== "assistant" || proposal === undefined) return [text];
  const handoff: HandoffPart = { proposalId: proposal.proposalId, decision: proposal.decision };
  return [text, { type: "data-handoff", id: handoff.proposalId, data: handoff }];
}

type SessionStorage = Pick<Storage, "getItem" | "setItem">;

type PendingSession = {
  current: Promise<string> | undefined;
};

const pendingSession: PendingSession = { current: undefined };

export function loadChatSession(input: {
  storage: SessionStorage;
  timezone: string;
  request: (timezone: string) => Promise<string>;
  pending?: PendingSession;
}): Promise<string> {
  const pending = input.pending ?? pendingSession;
  const stored = sessionIdSchema.safeParse(input.storage.getItem(sessionStorageKey));
  if (stored.success) return Promise.resolve(stored.data);

  pending.current ??= input
    .request(input.timezone)
    .then((id) => {
      const created = sessionIdSchema.safeParse(id);
      if (!created.success) throw new Error("session id was missing");
      input.storage.setItem(sessionStorageKey, created.data);
      return created.data;
    })
    .catch((error: unknown) => {
      pending.current = undefined;
      throw error;
    });
  return pending.current;
}
