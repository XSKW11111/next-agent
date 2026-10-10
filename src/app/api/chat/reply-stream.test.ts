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

test("a reply with a handoff part emits that proposal after the text", async () => {
  const parsed = await chunks(
    replyStreamResponse("A person can take this from here.", {
      proposalId: "33333333-3333-4333-8333-333333333333",
      decision: "pending",
    }),
  );
  const types = parsed.map((chunk) => {
    if (!isRecord(chunk) || typeof chunk.type !== "string") throw new Error("chunk was missing type");
    return chunk.type;
  });
  const handoffAt = types.indexOf("data-handoff");

  expect(types[handoffAt - 1]).toBe("text-end");
  expect(types[handoffAt + 1]).toBe("finish-step");
  expect(parsed.filter((chunk) => isRecord(chunk) && chunk.type === "data-handoff")).toEqual([
    {
      type: "data-handoff",
      id: "33333333-3333-4333-8333-333333333333",
      data: {
        proposalId: "33333333-3333-4333-8333-333333333333",
        decision: "pending",
      },
    },
  ]);
});

test("a reply without a handoff omits the data part", async () => {
  const response = replyStreamResponse("On the way.");

  expect(await chunkTypes(response)).toEqual([
    "start",
    "start-step",
    "text-start",
    "text-delta",
    "text-end",
    "finish-step",
    "finish",
  ]);
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

async function chunkTypes(response: Response): Promise<string[]> {
  const types: string[] = [];
  for (const chunk of await chunks(response)) {
    if (!isRecord(chunk) || typeof chunk.type !== "string") throw new Error("chunk was missing type");
    types.push(chunk.type);
  }
  return types;
}

async function chunks(response: Response): Promise<unknown[]> {
  const body = await response.text();
  const parsed: unknown[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length);
    if (payload === "[DONE]") continue;
    parsed.push(JSON.parse(payload));
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
