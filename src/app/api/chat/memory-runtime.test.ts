import { expect, test } from "vitest";
import { z } from "zod";
import { sessionIdSchema } from "../../../domain/session";
import { memoryReply } from "./memory-runtime";
import { currentChatRuntime } from "./runtime";
import { POST as createSession } from "./sessions/route";
import { POST as sendMessage } from "./sessions/[id]/messages/route";

test("the installed runtime creates a session and streams the memory reply", async () => {
  const runtime = currentChatRuntime();
  const created = await createSession(
    jsonRequest({ timezone: "Asia/Taipei" }),
    undefined,
    runtime,
  );

  expect(created.status).toBe(200);
  const session = z.strictObject({ id: z.uuid() }).parse(await created.json());
  const sessionId = sessionIdSchema.parse(session.id);
  expect(runtime.sessions.find(sessionId)?.localTimezone).toEqual({
    kind: "resolved",
    name: "Asia/Taipei",
  });

  const sent = await sendMessage(
    jsonRequest({ turnId: crypto.randomUUID(), text: "where is my order" }),
    { params: Promise.resolve({ id: sessionId }) },
    runtime,
  );

  expect(sent.status).toBe(200);
  expect(await replyText(sent)).toBe(memoryReply);
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function replyText(response: Response): Promise<string> {
  const body = await response.text();
  let text = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length);
    if (payload === "[DONE]") continue;
    const chunk: unknown = JSON.parse(payload);
    if (!isRecord(chunk) || chunk.type !== "text-delta") continue;
    if (typeof chunk.delta !== "string") throw new Error("text-delta was missing delta");
    text += chunk.delta;
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
