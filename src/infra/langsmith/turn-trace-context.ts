import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export type ReportedUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly audioInputTokens?: number;
  readonly imageInputTokens?: number;
  readonly videoInputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly audioOutputTokens?: number;
  readonly imageOutputTokens?: number;
  readonly totalCost?: number;
};

type ObservationBase = {
  readonly id: string;
  readonly parentId: string | null;
  readonly sequence: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly outcome: "success" | "unavailable" | "error";
};

export type TraceObservation =
  | (ObservationBase & {
      readonly kind: "model";
      readonly operation: "chat" | "summary";
      readonly model: string;
      readonly usage?: ReportedUsage;
    })
  | (ObservationBase & {
      readonly kind: "embedding";
      readonly model: string;
      readonly usage?: ReportedUsage;
    })
  | (ObservationBase & {
      readonly kind: "tool";
      readonly name: string;
      readonly callId: string;
    });

export type TurnTraceContext = {
  readonly rootRunId: string;
  readonly stepTimingsMs: Map<string, number>;
  readonly observations: TraceObservation[];
  nextObservationSequence: number;
};

type ObservationScope = {
  readonly turn: TurnTraceContext;
  readonly parentId: string | null;
};

const storage = new AsyncLocalStorage<ObservationScope>();

export function withTurnTraceContext<T>(
  context: TurnTraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ turn: context, parentId: null }, fn);
}

export function currentTurnTraceContext(): TurnTraceContext | null {
  return storage.getStore()?.turn ?? null;
}

export async function observeTool<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (scope === undefined) return fn();
  const start = startObservation(scope);
  try {
    const value = await storage.run({ turn: scope.turn, parentId: start.id }, fn);
    scope.turn.observations.push({ ...start, kind: "tool", name, callId: start.id, endedAtMs: Date.now(), outcome: isUnavailable(value) ? "unavailable" : "success" });
    return value;
  } catch (error) {
    scope.turn.observations.push({ ...start, kind: "tool", name, callId: start.id, endedAtMs: Date.now(), outcome: "error" });
    throw error;
  }
}

export async function observeProvider<T>(
  source: { readonly kind: "model"; readonly operation: "chat" | "summary"; readonly model: string }
    | { readonly kind: "embedding"; readonly model: string },
  fn: () => Promise<{ readonly value: T; readonly usage?: ReportedUsage; readonly model?: string }>,
): Promise<T> {
  const scope = storage.getStore();
  if (scope === undefined) return (await fn()).value;
  const start = startObservation(scope);
  try {
    const result = await fn();
    scope.turn.observations.push({ ...start, ...source, model: result.model ?? source.model, endedAtMs: Date.now(), outcome: "success", ...(result.usage === undefined ? {} : { usage: result.usage }) });
    return result.value;
  } catch (error) {
    scope.turn.observations.push({ ...start, ...source, endedAtMs: Date.now(), outcome: "error" });
    throw error;
  }
}

function startObservation(scope: ObservationScope): Pick<ObservationBase, "id" | "parentId" | "sequence" | "startedAtMs"> {
  const sequence = scope.turn.nextObservationSequence;
  scope.turn.nextObservationSequence += 1;
  return { id: randomUUID(), parentId: scope.parentId, sequence, startedAtMs: Date.now() };
}

function isUnavailable(value: unknown): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "service_unavailable";
}
