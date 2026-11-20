import { z } from "zod";
import { parse } from "../domain/parse";
import { sessionIdSchema, type SessionId } from "../domain/session";

const sessionKey = "next-agent-session-id";

const createdSessionSchema = z.object({
  id: sessionIdSchema,
});

export type SessionResolution =
  | { readonly kind: "resolved"; readonly sessionId: SessionId }
  | { readonly kind: "failed" };

type SessionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function sessionPath(sessionId: SessionId): string {
  return `/sessions/${sessionId}`;
}

let inFlight: Promise<SessionResolution> | null = null;

export function resolveTabSession(
  storage: Storage = sessionStorage,
  fetchImpl: SessionFetch = fetch,
): Promise<SessionResolution> {
  if (inFlight !== null) return inFlight;
  const pending = readOrCreateTabSession(storage, fetchImpl).finally(() => {
    if (inFlight === pending) inFlight = null;
  });
  inFlight = pending;
  return pending;
}

async function readOrCreateTabSession(
  storage: Storage,
  fetchImpl: SessionFetch,
): Promise<SessionResolution> {
  const stored = storage.getItem(sessionKey);
  if (stored !== null) {
    const parsed = parse(sessionIdSchema, stored);
    if (parsed.ok) return { kind: "resolved", sessionId: parsed.value };
    storage.removeItem(sessionKey);
  }

  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await fetchImpl("/api/chat/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone }),
    });
    if (!response.ok) return { kind: "failed" };
    const created = parse(createdSessionSchema, await response.json());
    if (!created.ok) return { kind: "failed" };
    storage.setItem(sessionKey, created.value.id);
    return { kind: "resolved", sessionId: created.value.id };
  } catch {
    return { kind: "failed" };
  }
}
