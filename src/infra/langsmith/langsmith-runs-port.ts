import { randomUUID } from "node:crypto";
import { Client } from "langsmith";
import type { LangSmithTraceConfig } from "./trace-config";
import type { TraceObservation } from "./turn-trace-context";

export type LangSmithRunsPort = {
  createRootRun(input: {
    readonly name: "support-turn";
    readonly project: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly tags: readonly string[];
  }): Promise<{ readonly runId: string }>;

  writeObservation(parentRunId: string, observation: TraceObservation): Promise<{ readonly runId: string }>;

  patchRun(
    runId: string,
    patch: {
      readonly inputs?: unknown;
      readonly outputs?: unknown;
      readonly extra?: Readonly<Record<string, unknown>>;
      readonly error?: string;
      readonly end?: boolean;
    },
  ): Promise<void>;

  readRunTree(runId: string): Promise<unknown>;
};

type StoredRun = {
  readonly id: string;
  readonly name: string;
  readonly runType: string;
  readonly parentRunId: string | null;
  readonly project: string;
  inputs: unknown;
  outputs: unknown;
  extra: Record<string, unknown>;
  error: string | null;
  readonly children: string[];
  readonly startTime?: number;
  readonly endTime?: number;
};

export function memoryLangSmithRunsPort(): LangSmithRunsPort & {
  readonly runs: ReadonlyMap<string, StoredRun>;
} {
  const runs = new Map<string, StoredRun>();

  return {
    runs,
    async createRootRun(input) {
      const runId = randomUUID();
      runs.set(runId, {
        id: runId,
        name: input.name,
        runType: "chain",
        parentRunId: null,
        project: input.project,
        inputs: {
          sessionId: input.sessionId,
          turnId: input.turnId,
          tags: [...input.tags],
        },
        outputs: null,
        extra: {},
        error: null,
        children: [],
      });
      return { runId };
    },
    async writeObservation(parentRunId, observation) {
      const parent = runs.get(parentRunId);
      if (parent === undefined) throw new Error("parent run is missing");
      const runId = randomUUID();
      const details = observationDetails(observation);
      runs.set(runId, {
        id: runId,
        name: details.name,
        runType: details.runType,
        parentRunId,
        project: parent.project,
        inputs: details.inputs,
        outputs: details.outputs,
        extra: details.extra,
        error: observation.outcome === "error" ? observationError(observation) : null,
        children: [],
        startTime: observation.startedAtMs,
        endTime: observation.endedAtMs,
      });
      parent.children.push(runId);
      return { runId };
    },
    async patchRun(runId, patch) {
      const run = runs.get(runId);
      if (run === undefined) throw new Error("run is missing");
      if (patch.inputs !== undefined) run.inputs = patch.inputs;
      if (patch.outputs !== undefined) run.outputs = patch.outputs;
      if (patch.extra !== undefined) Object.assign(run.extra, patch.extra);
      if (patch.error !== undefined) run.error = patch.error;
    },
    async readRunTree(runId) {
      const root = runs.get(runId);
      if (root === undefined) throw new Error("run is missing");
      return serialize(root, runs);
    },
  };
}

export function createLangSmithRunsPort(config: LangSmithTraceConfig): LangSmithRunsPort {
  const client = new Client({ apiKey: config.apiKey });
  return {
    async createRootRun(input) {
      const runId = randomUUID();
      await client.createRun({
        id: runId,
        name: input.name,
        run_type: "chain",
        project_name: input.project,
        inputs: {
          sessionId: input.sessionId,
          turnId: input.turnId,
        },
        extra: { tags: [...input.tags] },
        start_time: Date.now(),
      });
      return { runId };
    },
    async writeObservation(parentRunId, observation) {
      const runId = randomUUID();
      const details = observationDetails(observation);
      await client.createRun({
        id: runId,
        name: details.name,
        run_type: details.runType,
        project_name: config.project,
        parent_run_id: parentRunId,
        inputs: details.inputs,
        outputs: details.outputs,
        extra: details.extra,
        ...(observation.outcome === "error" ? { error: observationError(observation) } : {}),
        start_time: observation.startedAtMs,
        end_time: observation.endedAtMs,
      });
      return { runId };
    },
    async patchRun(runId, patch) {
      await client.updateRun(runId, {
        ...(patch.inputs === undefined ? {} : { inputs: asRecord(patch.inputs) }),
        ...(patch.outputs === undefined ? {} : { outputs: asRecord(patch.outputs) }),
        ...(patch.extra === undefined ? {} : { extra: { ...patch.extra } }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
        ...(patch.end === false ? {} : { end_time: Date.now() }),
      });
    },
    async readRunTree(runId) {
      const run = await client.readRun(runId, { loadChildRuns: true });
      return run;
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function serialize(run: StoredRun, runs: ReadonlyMap<string, StoredRun>): unknown {
  return {
    id: run.id,
    name: run.name,
    run_type: run.runType,
    inputs: run.inputs,
    outputs: run.outputs,
    extra: run.extra,
    error: run.error,
    start_time: run.startTime,
    end_time: run.endTime,
    child_runs: run.children.map((childId) => {
      const child = runs.get(childId);
      if (child === undefined) throw new Error("child run is missing");
      return serialize(child, runs);
    }),
  };
}

function observationDetails(observation: TraceObservation): {
  readonly name: string;
  readonly runType: "llm" | "tool";
  readonly inputs: Record<string, unknown>;
  readonly outputs: Record<string, unknown>;
  readonly extra: Record<string, unknown>;
} {
  switch (observation.kind) {
    case "model":
      return {
        name: observation.operation === "summary" ? "summarize" : "chat-completion",
        runType: "llm",
        inputs: { operation: observation.operation },
        outputs: providerOutputs(observation),
        extra: { metadata: { ls_provider: "openrouter", ls_model_name: observation.model, usageReported: observation.usage?.totalTokens !== undefined, costReported: observation.usage?.totalCost !== undefined } },
      };
    case "embedding":
      return {
        name: "embed-query",
        runType: "llm",
        inputs: {},
        outputs: providerOutputs(observation),
        extra: { metadata: { ls_provider: "openrouter", ls_model_name: observation.model, operation: "embedding", usageReported: observation.usage?.totalTokens !== undefined, costReported: observation.usage?.totalCost !== undefined } },
      };
    case "tool":
      return {
        name: observation.name,
        runType: "tool",
        inputs: { callId: observation.callId },
        outputs: { outcome: observation.outcome },
        extra: {},
      };
    default: {
      const unexpected: never = observation;
      return unexpected;
    }
  }
}

function providerOutputs(observation: Extract<TraceObservation, { kind: "model" | "embedding" }>): Record<string, unknown> {
  const usage = observation.usage;
  if (usage === undefined) return { outcome: observation.outcome };
  const inputTokenDetails = {
    ...(usage.cachedInputTokens === undefined ? {} : { cache_read: usage.cachedInputTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cache_creation: usage.cacheWriteTokens }),
    ...(usage.audioInputTokens === undefined ? {} : { audio: usage.audioInputTokens }),
    ...(usage.imageInputTokens === undefined ? {} : { image: usage.imageInputTokens }),
    ...(usage.videoInputTokens === undefined ? {} : { video: usage.videoInputTokens }),
  };
  const outputTokenDetails = {
    ...(usage.reasoningOutputTokens === undefined ? {} : { reasoning: usage.reasoningOutputTokens }),
    ...(usage.audioOutputTokens === undefined ? {} : { audio: usage.audioOutputTokens }),
    ...(usage.imageOutputTokens === undefined ? {} : { image: usage.imageOutputTokens }),
  };
  return {
    outcome: observation.outcome,
    usage_metadata: {
      ...(usage.inputTokens === undefined ? {} : { input_tokens: usage.inputTokens }),
      ...(usage.outputTokens === undefined ? {} : { output_tokens: usage.outputTokens }),
      ...(usage.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
      ...(Object.keys(inputTokenDetails).length === 0 ? {} : { input_token_details: inputTokenDetails }),
      ...(Object.keys(outputTokenDetails).length === 0 ? {} : { output_token_details: outputTokenDetails }),
      ...(usage.totalCost === undefined ? {} : { total_cost: usage.totalCost }),
    },
  };
}

function observationError(observation: TraceObservation): string {
  switch (observation.kind) {
    case "model":
      return "model call failed";
    case "embedding":
      return "embedding call failed";
    case "tool":
      return "tool call failed";
    default: {
      const unexpected: never = observation;
      return unexpected;
    }
  }
}
