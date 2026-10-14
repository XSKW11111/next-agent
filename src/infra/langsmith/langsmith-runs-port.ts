import { randomUUID } from "node:crypto";
import { Client } from "langsmith";
import type { DebugTraceConfig } from "./debug-trace-config";

export type LangSmithRunsPort = {
  createRootRun(input: {
    readonly name: "support-turn";
    readonly project: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly tags: readonly string[];
  }): Promise<{ readonly runId: string }>;

  createChildRun(input: {
    readonly parentRunId: string;
    readonly name: string;
    readonly runType: "llm" | "tool" | "chain";
  }): Promise<{ readonly runId: string }>;

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
};

/** In-memory store for unit tests and offline projection. */
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
    async createChildRun(input) {
      const parent = runs.get(input.parentRunId);
      if (parent === undefined) throw new Error("parent run is missing");
      const runId = randomUUID();
      runs.set(runId, {
        id: runId,
        name: input.name,
        runType: input.runType,
        parentRunId: input.parentRunId,
        project: parent.project,
        inputs: {},
        outputs: null,
        extra: {},
        error: null,
        children: [],
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

export function createLangSmithRunsPort(config: DebugTraceConfig): LangSmithRunsPort {
  if (!config.enabled) {
    throw new Error("LangSmith runs port requires debug tracing to be enabled");
  }
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
    async createChildRun(input) {
      const runId = randomUUID();
      await client.createRun({
        id: runId,
        name: input.name,
        run_type: input.runType,
        parent_run_id: input.parentRunId,
        inputs: {},
        start_time: Date.now(),
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
    child_runs: run.children.map((childId) => {
      const child = runs.get(childId);
      if (child === undefined) throw new Error("child run is missing");
      return serialize(child, runs);
    }),
  };
}
