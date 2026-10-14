import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { localObservabilityStore } from "./local-observability-store";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("localObservabilityStore", () => {
  test("saves latency and lists newest first", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "obs-"));
    dirs.push(root);
    const store = localObservabilityStore(root);

    await store.save({
      id: "run-1",
      sessionId: "sess",
      turnId: "turn-a",
      savedAt: "2026-10-14T10:00:00.000Z",
      currentSentence: "hello",
      reply: "hi",
      serverLatencyMs: 42,
      stepTimingsMs: { "support-graph": 10 },
      trace: null,
      sink: "local",
    });
    await store.save({
      id: "run-2",
      sessionId: "sess",
      turnId: "turn-b",
      savedAt: "2026-10-14T11:00:00.000Z",
      currentSentence: "again",
      reply: "ok",
      serverLatencyMs: 7,
      stepTimingsMs: {},
      trace: {
        traceId: "run-2",
        input: {
          systemPrompt: "sys",
          priorTurns: [],
          currentSentence: "again",
          summaryText: null,
          timezone: { kind: "unresolved" },
        },
        output: {
          assistantLine: "ok",
          toolResults: [],
          waitingCalls: [],
          chunkPlans: [],
        },
        stepTimingsMs: {},
        modelFailure: null,
      },
      sink: "local",
    });

    const listed = await store.list();
    expect(listed.map((row) => row.id)).toEqual(["run-2", "run-1"]);
    expect(listed[0]).toMatchObject({
      id: "run-2",
      hasTrace: true,
      serverLatencyMs: 7,
    });
    const loaded = await store.get("run-2");
    expect(loaded?.trace?.output.assistantLine).toBe("ok");
  });
});
