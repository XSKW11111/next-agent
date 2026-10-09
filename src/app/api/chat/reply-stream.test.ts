import { expect, test } from "vitest";
import { replyStreamResponse } from "./reply-stream";

test("a short reply is one text delta", async () => {
  const response = replyStreamResponse("On the way.");

  expect(response.status).toBe(200);
  expect(await textDeltas(response)).toEqual(["On the way."]);
});

test("a longer reply is split into text deltas that join back to the reply", async () => {
  const response = replyStreamResponse("On the way. Extra.");

  expect(await textDeltas(response)).toEqual(["On the way. Extr", "a."]);
});

async function textDeltas(response: Response): Promise<string[]> {
  const body = await response.text();
  const deltas: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length);
    if (payload === "[DONE]") continue;
    const chunk: unknown = JSON.parse(payload);
    if (!isRecord(chunk) || chunk.type !== "text-delta") continue;
    if (typeof chunk.delta !== "string") throw new Error("text-delta was missing delta");
    deltas.push(chunk.delta);
  }
  return deltas;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
