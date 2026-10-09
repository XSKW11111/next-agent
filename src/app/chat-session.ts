import { z } from "zod";

export const sessionStorageKey = "next-agent.session-id";

const sessionIdSchema = z.uuid();

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
