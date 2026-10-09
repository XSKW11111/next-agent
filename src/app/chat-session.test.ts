import { expect, test } from "vitest";
import { loadChatSession, supportMessages } from "./chat-session";

const sessionId = "11111111-1111-4111-8111-111111111111";

test("a stored session id is reused without another request", async () => {
  const storage = memoryStorage({ "next-agent.session-id": sessionId });
  let calls = 0;

  const loaded = await loadChatSession({
    storage,
    timezone: "America/Chicago",
    pending: { current: undefined },
    request: async () => {
      calls += 1;
      return sessionId;
    },
  });

  expect(loaded).toBe(sessionId);
  expect(calls).toBe(0);
});

test("the first visit stores the id returned for the timezone", async () => {
  const storage = memoryStorage();
  const seen: string[] = [];

  const loaded = await loadChatSession({
    storage,
    timezone: "America/Chicago",
    pending: { current: undefined },
    request: async (timezone) => {
      seen.push(timezone);
      return sessionId;
    },
  });

  expect(loaded).toBe(sessionId);
  expect(seen).toEqual(["America/Chicago"]);
  expect(storage.getItem("next-agent.session-id")).toBe(sessionId);
});

test("two callers share one in-flight session request", async () => {
  const storage = memoryStorage();
  const pending = { current: undefined };
  let calls = 0;
  let finish: (id: string) => void = () => {
    throw new Error("the request was not started");
  };
  const request = () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };

  const first = loadChatSession({ storage, timezone: "Asia/Taipei", pending, request });
  const second = loadChatSession({ storage, timezone: "Asia/Taipei", pending, request });
  finish(sessionId);

  expect(await first).toBe(sessionId);
  expect(await second).toBe(sessionId);
  expect(calls).toBe(1);
});

test("a failed create can be retried", async () => {
  const storage = memoryStorage({ "next-agent.session-id": "not-a-session" });
  const pending = { current: undefined };
  let calls = 0;

  const request = async () => {
    calls += 1;
    if (calls === 1) throw new Error("session was not created");
    return sessionId;
  };

  await expect(
    loadChatSession({ storage, timezone: "America/Chicago", pending, request }),
  ).rejects.toThrow("session was not created");
  await expect(loadChatSession({ storage, timezone: "America/Chicago", pending, request })).resolves.toBe(
    sessionId,
  );
  expect(calls).toBe(2);
  expect(storage.getItem("next-agent.session-id")).toBe(sessionId);
});

test("history is ordered by sequence and spoken as user or assistant", () => {
  const turnId = "22222222-2222-4222-8222-222222222222";

  expect(
    supportMessages([
      { role: "assistant", content: "On the way.", sequence: 2, turnId, sessionId },
      { role: "customer", content: "where is my order", sequence: 1, turnId, sessionId },
    ]),
  ).toEqual([
    {
      id: `${turnId}:customer`,
      role: "user",
      parts: [{ type: "text", text: "where is my order" }],
    },
    {
      id: `${turnId}:assistant`,
      role: "assistant",
      parts: [{ type: "text", text: "On the way." }],
    },
  ]);
});

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}
