import { expect, test } from "vitest";
import { parse } from "../../domain/parse";
import { sessionIdSchema, type Session, type SessionId, type UnmatchedOrderStreak } from "../../domain/session";
import type { ProposalStore } from "../business/handoff/handoff";
import type { OrderCatalog, OrderStreakStore } from "../business/order/lookup-order";
import type { ProductSearchDependencies } from "../business/product/search-products";
import type { EarlyRisersCodeStore } from "../business/promotion/claim-early-risers";
import type { ScriptedModel, SupportTurnDependencies } from "../agent/support-turn";
import { projectSupportTurnTraceView } from "../trace/project-support-turn-trace-view";
import type { MessageStore, SequenceUpdate, TurnMessage } from "./message-store";
import { memoryLangSmithRunsPort } from "../../infra/langsmith/langsmith-runs-port";
import type { TraceObservation } from "../../infra/langsmith/turn-trace-context";
import { observeProvider } from "../../infra/langsmith/turn-trace-context";
import { createTurnTracingSession, submitTracedTurn } from "./submit-traced-turn";

const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const otherTurnId = "33333333-3333-4333-8333-333333333333";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("independent child runs flush concurrently while nested runs wait for their tool", async () => {
  const base = memoryLangSmithRunsPort();
  const root = await base.createRootRun({ name: "support-turn", project: "unit", sessionId, turnId, tags: [] });
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let sawFirst: (() => void) | undefined;
  let sawSecond: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => { sawFirst = resolve; });
  const secondStarted = new Promise<void>((resolve) => { sawSecond = resolve; });
  const calls: string[] = [];
  const tracing = createTurnTracingSession({
    config: { apiKey: "test", project: "unit" },
    client: { ...base, async writeObservation(parentRunId, observation) {
      calls.push(observation.id);
      if (observation.id === "tool-a") { sawFirst?.(); await firstGate; }
      if (observation.id === "tool-b") sawSecond?.();
      return base.writeObservation(parentRunId, observation);
    } },
  });
  const common = { startedAtMs: 10, endedAtMs: 20, outcome: "success" as const };
  const observations: TraceObservation[] = [
    { ...common, id: "tool-a", parentId: null, sequence: 0, kind: "tool", name: "search_products", callId: "a" },
    { ...common, id: "tool-b", parentId: null, sequence: 1, kind: "tool", name: "search_products", callId: "b" },
    { ...common, id: "embed-a", parentId: "tool-a", sequence: 2, kind: "embedding", model: "embedding", usage: { totalTokens: 3 } },
  ];
  const flushing = tracing.flushObservations(root.runId, observations);
  await Promise.all([firstStarted, secondStarted]);
  expect(calls).toEqual(["tool-a", "tool-b"]);
  releaseFirst?.();
  expect(await flushing).toBe(0);
  expect(calls).toEqual(["tool-a", "tool-b", "embed-a"]);
  const toolA = [...base.runs.values()].find((run) => run.inputs && typeof run.inputs === "object" && "callId" in run.inputs && run.inputs.callId === "a");
  const embedding = [...base.runs.values()].find((run) => run.name === "embed-query");
  expect(embedding?.parentRunId).toBe(toolA?.id);
});

test("child writes stay within the concurrency bound", async () => {
  const base = memoryLangSmithRunsPort();
  const root = await base.createRootRun({ name: "support-turn", project: "unit", sessionId, turnId, tags: [] });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reachedEight: (() => void) | undefined;
  const eightStarted = new Promise<void>((resolve) => { reachedEight = resolve; });
  let active = 0;
  let peak = 0;
  const tracing = createTurnTracingSession({
    config: { apiKey: "test", project: "unit" },
    client: { ...base, async writeObservation(parentRunId, observation) {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 8) reachedEight?.();
      await gate;
      const child = await base.writeObservation(parentRunId, observation);
      active -= 1;
      return child;
    } },
  });
  const observations: TraceObservation[] = Array.from({ length: 12 }, (_item, index) => ({
    id: `tool-${index}`, parentId: null, sequence: index, startedAtMs: 10, endedAtMs: 20,
    kind: "tool", name: "search_products", callId: `call-${index}`, outcome: "success",
  }));
  const flushing = tracing.flushObservations(root.runId, observations);
  await eightStarted;
  expect(peak).toBe(8);
  release?.();
  expect(await flushing).toBe(0);
  expect(peak).toBe(8);
  expect(base.runs.get(root.runId)?.children).toHaveLength(12);
});

test("a new traced turn records domain input and output on the root run", async () => {
  const messages = memoryMessages();
  const client = memoryLangSmithRunsPort();
  const tracing = createTurnTracingSession({
    config: { apiKey: "test", project: "unit" },
    client,
  });

  const result = await submitTracedTurn({
    sessionId,
    turnId,
    text: "where is my order",
    messages,
    model: replyModel("On the way."),
    dependencies: dependencies(),
    tracing,
  });

  expect(result.kind).toBe("reply");
  if (result.kind !== "reply" || result.langsmithRunId === null) {
    throw new Error("expected a traced reply");
  }
  expect(result.reply).toBe("On the way.");

  const view = await projectSupportTurnTraceView({
    client,
    runId: result.langsmithRunId,
    completion: result.completion,
    traceInput: result.traceInput,
  });

  expect(view.traceId).toBe(result.langsmithRunId);
  expect(view.input.currentSentence).toBe("where is my order");
  expect(view.input.priorTurns).toEqual([]);
  expect(view.input.timezone).toEqual({ kind: "unresolved" });
  expect(view.output.assistantLine).toBe("On the way.");
  expect(view.output.toolResults).toEqual([]);
  expect(view.output.waitingCalls).toEqual([]);
  expect(view.output.chunkPlans).toEqual([]);
  expect(view.modelFailure).toBeNull();
  expect(client.runs.get(result.langsmithRunId)?.extra).toMatchObject({
    providerCalls: 0,
    tokenUsageComplete: false,
    costUsageComplete: false,
    observationFailures: 0,
  });
  expect(view.stepTimingsMs).toMatchObject({
    "insert-customer": expect.any(Number),
    "prior-context": expect.any(Number),
    "support-graph": expect.any(Number),
  });
});

test("a same-text retry returns the saved reply without a second root run", async () => {
  const messages = memoryMessages();
  const client = memoryLangSmithRunsPort();
  const tracing = createTurnTracingSession({
    config: { apiKey: "test", project: "unit" },
    client,
  });
  const input = {
    sessionId,
    turnId,
    text: "where is my order",
    messages,
    model: replyModel("On the way."),
    dependencies: dependencies(),
    tracing,
  };

  const first = await submitTracedTurn(input);
  const second = await submitTracedTurn(input);

  expect(first.kind).toBe("reply");
  expect(second).toEqual({ kind: "reply", reply: "On the way.", langsmithRunId: null });
  expect(client.runs.size).toBe(1);
});

test("a traced tool round stores the chunk plan and tool result", async () => {
  const messages = memoryMessages();
  const client = memoryLangSmithRunsPort();
  const tracing = createTurnTracingSession({
    config: { apiKey: "test", project: "unit" },
    client,
  });
  let calls = 0;
  const model: ScriptedModel = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        return {
          text: "Looking.",
          toolCalls: [{ id: "search-1", name: "search_products", args: { mode: "list" } }],
        };
      }
      return { text: "Here are products." };
    },
  };

  const result = await submitTracedTurn({
    sessionId,
    turnId,
    text: "show products",
    messages,
    model,
    dependencies: dependencies(),
    tracing,
  });

  expect(result.kind).toBe("reply");
  if (result.kind !== "reply" || result.langsmithRunId === null) {
    throw new Error("expected a traced reply");
  }

  const view = await projectSupportTurnTraceView({
    client,
    runId: result.langsmithRunId,
    completion: result.completion,
    traceInput: result.traceInput,
  });

  expect(view.output.chunkPlans).toEqual([
    {
      chunkIndex: 0,
      calls: [{ callId: "search-1", tool: "search_products", kind: "read" }],
      parallelReadCallIds: ["search-1"],
      writeOrderCallIds: [],
    },
  ]);
  expect(view.output.toolResults).toHaveLength(1);
  expect(view.output.toolResults[0]?.tool).toBe("search_products");
  const root = client.runs.get(result.langsmithRunId);
  const tool = client.runs.get(root?.children[0] ?? "");
  expect(tool).toMatchObject({ name: "search_products", runType: "tool", inputs: { callId: expect.stringMatching(uuidPattern) }, outputs: { outcome: "success" } });
  expect(tool?.children).toEqual([]);
});

test("root reports only provider supplied usage and executed tool counts", async () => {
  const client = memoryLangSmithRunsPort();
  const tracing = createTurnTracingSession({ config: { apiKey: "test", project: "unit" }, client });
  let calls = 0;
  const result = await submitTracedTurn({
    sessionId, turnId, text: "show products", messages: memoryMessages(), tracing,
    model: { complete() {
      calls += 1;
      return observeProvider({ kind: "model", operation: "chat", model: "provider-model" }, async () => ({
        value: calls === 1
          ? { text: "Looking.", toolCalls: [{ id: "search-1", name: "search_products", args: { mode: "list" } }] }
          : { text: "Here are products." },
        ...(calls === 1 ? { usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10, cachedInputTokens: 2, reasoningOutputTokens: 1, totalCost: 0.00000541 } } : {}),
      }));
    } },
    dependencies: dependencies(),
  });
  if (result.kind !== "reply" || result.langsmithRunId === null) throw new Error("expected traced reply");
  const root = client.runs.get(result.langsmithRunId);
  expect(root?.extra).toMatchObject({
    providerCalls: 2, modelCalls: 2, embeddingCalls: 0, toolCalls: 1, skippedToolCalls: 0,
    toolOutcomes: { success: 1, unavailable: 0, error: 0 },
    providerOutcomes: { success: 2, error: 0 },
    observedUsage: { inputTokens: 7, outputTokens: 3, totalTokens: 10, cachedInputTokens: 2, reasoningOutputTokens: 1, totalCost: 0.00000541 },
    tokenUsageComplete: false, costUsageComplete: false, observationFailures: 0,
  });
  expect(root?.children).toHaveLength(3);
});

test("a child trace write failure preserves the saved reply and executes a tool once", async () => {
  const messages = memoryMessages();
  const base = memoryLangSmithRunsPort();
  let childWrites = 0;
  let productLists = 0;
  const tracing = createTurnTracingSession({
    config: { apiKey: "test", project: "unit" },
    client: { ...base, async writeObservation() { childWrites += 1; throw new Error("trace unavailable"); } },
  });
  let modelCalls = 0;
  const result = await submitTracedTurn({
    sessionId, turnId, text: "show products", messages, tracing,
    model: { async complete() {
      modelCalls += 1;
      return modelCalls === 1
        ? { text: "Looking.", toolCalls: [{ id: "search-1", name: "search_products", args: { mode: "list" } }] }
        : { text: "Here are products." };
    } },
    dependencies: {
      ...dependencies(),
      products: {
        ...productDependencies(),
        catalog: { async matchProducts() { return []; }, async listProducts() { productLists += 1; return []; } },
      },
    },
  });
  expect(result.kind).toBe("reply");
  if (result.kind !== "reply" || result.langsmithRunId === null) throw new Error("expected traced reply");
  expect(result.reply).toBe("Here are products.");
  expect(productLists).toBe(1);
  expect(childWrites).toBe(1);
  expect(messages.rows().filter((row) => row.role === "assistant")).toHaveLength(1);
  expect(base.runs.get(result.langsmithRunId)?.extra).toMatchObject({ observationFailures: 1 });
});

test("a failed model after a tool still flushes completed tool spans", async () => {
  const messages = memoryMessages();
  const client = memoryLangSmithRunsPort();
  const tracing = createTurnTracingSession({ config: { apiKey: "test", project: "unit" }, client });
  let modelCalls = 0;
  await expect(submitTracedTurn({
    sessionId, turnId, text: "show products", messages, tracing, dependencies: dependencies(),
    model: { async complete() {
      modelCalls += 1;
      if (modelCalls === 1) return { text: "Looking.", toolCalls: [{ id: "search-1", name: "search_products", args: { mode: "list" } }] };
      throw new Error("model unavailable");
    } },
  })).rejects.toThrow("model unavailable");
  const root = [...client.runs.values()].find((run) => run.parentRunId === null);
  const child = [...client.runs.values()].find((run) => run.parentRunId === root?.id);
  expect(root?.error).toBe("model unavailable");
  expect(child).toMatchObject({ name: "search_products", inputs: { callId: expect.stringMatching(uuidPattern) }, outputs: { outcome: "success" } });
  expect(root?.extra).toMatchObject({ observationFailures: 0 });
});

test("tool child spans omit customer arguments and returned data", async () => {
  const client = memoryLangSmithRunsPort();
  const tracing = createTurnTracingSession({ config: { apiKey: "test", project: "unit" }, client });
  let modelCalls = 0;
  const result = await submitTracedTurn({
    sessionId, turnId, text: "private customer question", messages: memoryMessages(), tracing,
    model: { async complete() {
      modelCalls += 1;
      return modelCalls === 1
        ? { text: "Checking.", toolCalls: [{ id: "secret-marker@example.com", name: "lookup_order", args: { email: "secret-marker@example.com", order_number: "#W123" } }] }
        : { text: "Done." };
    } },
    dependencies: dependencies(),
  });
  if (result.kind !== "reply" || result.langsmithRunId === null) throw new Error("expected traced reply");
  const root = client.runs.get(result.langsmithRunId);
  const child = client.runs.get(root?.children[0] ?? "");
  expect(child).toMatchObject({ name: "lookup_order", inputs: { callId: expect.stringMatching(uuidPattern) }, outputs: { outcome: "success" } });
  expect(JSON.stringify({ inputs: child?.inputs, outputs: child?.outputs, extra: child?.extra })).not.toMatch(/secret-marker|#W123|private customer question/);
  expect(result.reply).toBe("Done.");
});

test("a second turn includes the first completed pair in the trace input", async () => {
  const messages = memoryMessages();
  const client = memoryLangSmithRunsPort();
  const tracing = createTurnTracingSession({
    config: { apiKey: "test", project: "unit" },
    client,
  });

  await submitTracedTurn({
    sessionId,
    turnId,
    text: "first question",
    messages,
    model: replyModel("first answer"),
    dependencies: dependencies(),
    tracing,
  });

  const second = await submitTracedTurn({
    sessionId,
    turnId: otherTurnId,
    text: "follow up",
    messages,
    model: replyModel("second answer"),
    dependencies: dependencies(),
    tracing,
  });

  expect(second.kind).toBe("reply");
  if (second.kind !== "reply" || second.langsmithRunId === null || !("traceInput" in second)) {
    throw new Error("expected a traced reply");
  }
  expect(second.traceInput.priorTurns).toEqual([
    { customer: "first question", assistant: "first answer" },
  ]);
  expect(second.traceInput.currentSentence).toBe("follow up");
});

function replyModel(text: string): ScriptedModel {
  return {
    async complete() {
      return { text };
    },
  };
}

function dependencies(): SupportTurnDependencies {
  return {
    orders: {
      catalog: emptyCatalog(),
      streaks: memoryStreaks(),
    },
    products: productDependencies(),
    promotion: {
      session: session(),
      now: new Date("2026-10-13T02:00:00.000Z"),
      store: emptyEarlyRisers(),
    },
    handoff: {
      store: emptyProposals(),
      turnId,
      proposalId: "44444444-4444-4444-8444-444444444444",
    },
  };
}

function emptyCatalog(): OrderCatalog {
  return {
    async listOrdersForEmail() {
      return { kind: "ready", orders: [] };
    },
  };
}

function memoryStreaks(): OrderStreakStore {
  let streak: UnmatchedOrderStreak = 0;
  return {
    async read() {
      return { kind: "ready", streak };
    },
    async write(_sessionId, next) {
      streak = next;
      return { kind: "ready" };
    },
  };
}

function productDependencies(): ProductSearchDependencies {
  return {
    catalog: {
      async matchProducts() {
        return [];
      },
      async listProducts() {
        return [];
      },
    },
    embedder: {
      async embed() {
        return [0.1, 0.2];
      },
    },
  };
}

function emptyEarlyRisers(): EarlyRisersCodeStore {
  return {
    async insertOrReuse() {
      throw new Error("claim was not part of this turn");
    },
  };
}

function emptyProposals(): ProposalStore {
  return {
    listProposals() {
      return [];
    },
    findProposalForTurn() {
      return undefined;
    },
    findProposal() {
      return undefined;
    },
    saveProposal() {},
    findCase() {
      return undefined;
    },
    saveCase() {},
  };
}

function session(): Session {
  const parsed = parse(sessionIdSchema, sessionId);
  if (!parsed.ok) throw new Error("session id is invalid");
  return {
    id: parsed.value,
    localTimezone: { kind: "unresolved" },
    unmatchedOrderStreak: 0,
  };
}

function memoryMessages(): MessageStore & { rows(): readonly TurnMessage[] } {
  const rows: TurnMessage[] = [];
  let nextSequence = 1;
  return {
    rows: () => rows,
    async messagesForSession(id: SessionId) {
      return rows.filter((row) => row.sessionId === id);
    },
    async messagesForTurn(id: SessionId, turn: string) {
      return rows.filter((row) => row.sessionId === id && row.turnId === turn);
    },
    async insert(row: TurnMessage) {
      rows.push(row);
    },
    async readNextSequence() {
      return nextSequence;
    },
    async conditionalUpdate(_sessionId: SessionId, expected: number): Promise<SequenceUpdate> {
      if (expected !== nextSequence) return { kind: "unchanged" };
      const sequence = nextSequence;
      nextSequence += 1;
      return { kind: "updated", sequence };
    },
  };
}
