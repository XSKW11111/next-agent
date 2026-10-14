import type {
  SupportTurnTraceInput,
  SupportTurnTraceOutput,
  SupportTurnTraceView,
} from "../../domain/support-turn-trace";
import type { LangSmithRunsPort } from "../../infra/langsmith/langsmith-runs-port";
import type { TurnCompletion } from "../agent/support-turn";
import { buildTraceOutput } from "./build-trace-io";

export type ProjectTraceViewInput = {
  readonly client: LangSmithRunsPort;
  readonly runId: string;
  readonly completion: TurnCompletion;
  readonly traceInput: SupportTurnTraceInput;
};

/**
 * Projects the patched root run into the domain trace view.
 * Prefers completion/traceInput when the run tree omits domain fields.
 */
export async function projectSupportTurnTraceView(
  input: ProjectTraceViewInput,
): Promise<SupportTurnTraceView> {
  const tree = await input.client.readRunTree(input.runId);
  const root = asRoot(tree);
  const patchedInput = asTraceInput(root.inputs) ?? input.traceInput;
  const patchedOutput = asTraceOutput(root.outputs) ?? buildTraceOutput(input.completion);
  const stepTimingsMs = asStepTimings(root.extra?.stepTimingsMs);
  const modelFailure =
    typeof root.error === "string" && root.error.length > 0
      ? { message: root.error }
      : null;

  return {
    traceId: input.runId,
    input: patchedInput,
    output: patchedOutput,
    stepTimingsMs,
    modelFailure,
  };
}

type RootWire = {
  readonly inputs: unknown;
  readonly outputs: unknown;
  readonly extra?: { readonly stepTimingsMs?: unknown };
  readonly error: string | null;
};

function asRoot(tree: unknown): RootWire {
  if (tree === null || typeof tree !== "object") {
    throw new Error("run tree is not an object");
  }
  const record = tree as Record<string, unknown>;
  return {
    inputs: record.inputs,
    outputs: record.outputs,
    extra:
      record.extra !== null && typeof record.extra === "object"
        ? (record.extra as { readonly stepTimingsMs?: unknown })
        : undefined,
    error: typeof record.error === "string" ? record.error : null,
  };
}

function asTraceInput(value: unknown): SupportTurnTraceInput | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Partial<SupportTurnTraceInput>;
  if (typeof record.systemPrompt !== "string") return null;
  if (!Array.isArray(record.priorTurns)) return null;
  if (typeof record.currentSentence !== "string") return null;
  if (record.timezone === undefined) return null;
  return value as SupportTurnTraceInput;
}

function asTraceOutput(value: unknown): SupportTurnTraceOutput | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Partial<SupportTurnTraceOutput>;
  if (typeof record.assistantLine !== "string") return null;
  if (!Array.isArray(record.toolResults)) return null;
  if (!Array.isArray(record.waitingCalls)) return null;
  if (!Array.isArray(record.chunkPlans)) return null;
  return value as SupportTurnTraceOutput;
}

function asStepTimings(value: unknown): Readonly<Record<string, number>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const timings: Record<string, number> = {};
  for (const [key, ms] of Object.entries(value)) {
    if (typeof ms === "number" && Number.isFinite(ms)) timings[key] = ms;
  }
  return timings;
}
