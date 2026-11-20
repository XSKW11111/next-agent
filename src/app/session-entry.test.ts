import { expect, test } from "vitest";
import { resolveTabSession } from "./session-entry";

const sessionKey = "next-agent-session-id";
const storedId = "11111111-1111-4111-8111-111111111111";
const createdId = "22222222-2222-4222-8222-222222222222";

test("a stored session id is reused without creating another", async () => {
  const storage = memoryStorage(storedId);
  let posts = 0;
  const result = await resolveTabSession(storage, async () => {
    posts += 1;
    return Response.json({ id: createdId });
  });

  expect(posts).toBe(0);
  expect(result).toEqual({ kind: "resolved", sessionId: storedId });
  expect(storage.getItem(sessionKey)).toBe(storedId);
});

test("a missing session id is created and stored", async () => {
  const storage = memoryStorage(null);
  const calls: { url: string; method: string; body: string }[] = [];
  const result = await resolveTabSession(storage, async (input, init) => {
    calls.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Response.json({ id: createdId });
  });

  expect(calls).toEqual([
    {
      url: "/api/chat/sessions",
      method: "POST",
      body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    },
  ]);
  expect(result).toEqual({ kind: "resolved", sessionId: createdId });
  expect(storage.getItem(sessionKey)).toBe(createdId);
});

test("a failed create stores nothing", async () => {
  const storage = memoryStorage(null);
  const result = await resolveTabSession(storage, async () => new Response(null, { status: 500 }));

  expect(result).toEqual({ kind: "failed" });
  expect(storage.getItem(sessionKey)).toBeNull();
});

test("a malformed stored id is not reused", async () => {
  const storage = memoryStorage("not-a-session");
  let posts = 0;
  const result = await resolveTabSession(storage, async () => {
    posts += 1;
    return Response.json({ id: createdId });
  });

  expect(posts).toBe(1);
  expect(result).toEqual({ kind: "resolved", sessionId: createdId });
  expect(storage.getItem(sessionKey)).toBe(createdId);
});

test("overlapping calls create one session", async () => {
  const storage = memoryStorage(null);
  let posts = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = async () => {
    posts += 1;
    await gate;
    return Response.json({ id: createdId });
  };

  const first = resolveTabSession(storage, fetchImpl);
  const second = resolveTabSession(storage, fetchImpl);
  release();
  const [left, right] = await Promise.all([first, second]);

  expect(posts).toBe(1);
  expect(left).toEqual({ kind: "resolved", sessionId: createdId });
  expect(right).toEqual(left);
  expect(storage.getItem(sessionKey)).toBe(createdId);
});

test("an unreadable create response stores nothing", async () => {
  const storage = memoryStorage(null);
  const result = await resolveTabSession(
    storage,
    async () => new Response("nope", { status: 200, headers: { "content-type": "application/json" } }),
  );

  expect(result).toEqual({ kind: "failed" });
  expect(storage.getItem(sessionKey)).toBeNull();
});

function memoryStorage(stored: string | null): Storage {
  const values = new Map<string, string>();
  if (stored !== null) values.set(sessionKey, stored);
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
