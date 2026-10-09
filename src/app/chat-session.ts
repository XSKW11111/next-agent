import type { UIMessage } from "ai";
import { z } from "zod";

export const sessionStorageKey = "next-agent.session-id";

const sessionIdSchema = z.uuid();

const storedMessageSchema = z.strictObject({
  role: z.enum(["customer", "assistant"]),
  content: z.string(),
  sequence: z.number().int(),
  turnId: z.uuid(),
  sessionId: z.uuid(),
});

export const supportHistorySchema = z.strictObject({
  messages: z.array(storedMessageSchema),
});

export function supportMessages(
  rows: readonly z.infer<typeof storedMessageSchema>[],
): UIMessage[] {
  return [...rows]
    .sort((left, right) => left.sequence - right.sequence)
    .map((row) => ({
      id: `${row.turnId}:${row.role}`,
      role: row.role === "customer" ? "user" : "assistant",
      parts: [{ type: "text" as const, text: row.content }],
    }));
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
