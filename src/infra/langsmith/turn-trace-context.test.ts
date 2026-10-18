import { expect, test } from "vitest";
import { memoryLangSmithRunsPort } from "./langsmith-runs-port";
import { observeProvider, observeTool, withTurnTraceContext, type TurnTraceContext } from "./turn-trace-context";

test("concurrent tool scopes parent their own embedding observations", async () => {
  const context: TurnTraceContext = {
    rootRunId: "root",
    stepTimingsMs: new Map(),
    observations: [],
    nextObservationSequence: 0,
  };
  await withTurnTraceContext(context, async () => {
    await Promise.all([
      observeTool("search-a", () => observeProvider(
        { kind: "embedding", model: "embedding-model" },
        async () => ({ value: [1], usage: { inputTokens: 6, totalTokens: 6, totalCost: 0.000001 } }),
      )),
      observeTool("search-b", () => observeProvider(
        { kind: "embedding", model: "embedding-model" },
        async () => ({ value: [2], usage: { inputTokens: 7, totalTokens: 7 } }),
      )),
    ]);
  });

  const tools = context.observations.filter((observation) => observation.kind === "tool");
  const embeddings = context.observations.filter((observation) => observation.kind === "embedding");
  expect(tools).toHaveLength(2);
  expect(embeddings).toHaveLength(2);
  expect(embeddings[0]?.parentId).toBe(tools.find((tool) => tool.name === "search-a")?.id);
  expect(embeddings[1]?.parentId).toBe(tools.find((tool) => tool.name === "search-b")?.id);
  expect(tools.every((tool) => tool.callId === tool.id)).toBe(true);
  expect(context.observations.map((observation) => observation.sequence).sort()).toEqual([0, 1, 2, 3]);
});

test("LangSmith child output uses standard usage fields and omits private tool payloads", async () => {
  const port = memoryLangSmithRunsPort();
  const root = await port.createRootRun({ name: "support-turn", project: "unit", sessionId: "session", turnId: "turn", tags: [] });
  const tool = await port.writeObservation(root.runId, {
    id: "local-tool", parentId: null, sequence: 0, startedAtMs: 10, endedAtMs: 20,
    outcome: "success", kind: "tool", name: "search_products", callId: "call-a",
  });
  await port.writeObservation(tool.runId, {
    id: "local-embedding", parentId: "local-tool", sequence: 1, startedAtMs: 12, endedAtMs: 18,
    outcome: "success", kind: "embedding", model: "openai/text-embedding-3-small",
    usage: { inputTokens: 6, totalTokens: 6, cachedInputTokens: 2, cacheWriteTokens: 1, audioInputTokens: 0, imageInputTokens: 0, videoInputTokens: 0, reasoningOutputTokens: 0, audioOutputTokens: 0, imageOutputTokens: 0, totalCost: 0.000001 },
  });
  expect(await port.readRunTree(root.runId)).toMatchObject({
    child_runs: [{
      run_type: "tool", name: "search_products", inputs: { callId: "call-a" }, outputs: { outcome: "success" },
      child_runs: [{
        run_type: "llm", name: "embed-query", start_time: 12, end_time: 18,
        outputs: { usage_metadata: {
          input_tokens: 6, total_tokens: 6, total_cost: 0.000001,
          input_token_details: { cache_read: 2, cache_creation: 1, audio: 0, image: 0, video: 0 },
          output_token_details: { reasoning: 0, audio: 0, image: 0 },
        } },
      }],
    }],
  });
});

test("failed child runs carry a generic LangSmith error without exception text", async () => {
  const port = memoryLangSmithRunsPort();
  const root = await port.createRootRun({ name: "support-turn", project: "unit", sessionId: "session", turnId: "turn", tags: [] });
  await port.writeObservation(root.runId, {
    id: "failed-model", parentId: null, sequence: 0, startedAtMs: 10, endedAtMs: 20,
    outcome: "error", kind: "model", operation: "chat", model: "safe-model",
  });
  await port.writeObservation(root.runId, {
    id: "unavailable-tool", parentId: null, sequence: 1, startedAtMs: 11, endedAtMs: 21,
    outcome: "unavailable", kind: "tool", name: "lookup_order", callId: "safe-id",
  });
  expect(await port.readRunTree(root.runId)).toMatchObject({
    child_runs: [
      { name: "chat-completion", outputs: { outcome: "error" }, error: "model call failed" },
      { name: "lookup_order", outputs: { outcome: "unavailable" }, error: null },
    ],
  });
});
