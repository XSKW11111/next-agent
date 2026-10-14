import { AsyncLocalStorage } from "node:async_hooks";

export type TurnTraceContext = {
  readonly rootRunId: string;
  readonly stepTimingsMs: Map<string, number>;
};

const storage = new AsyncLocalStorage<TurnTraceContext>();

export function withTurnTraceContext<T>(
  context: TurnTraceContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function currentTurnTraceContext(): TurnTraceContext | null {
  return storage.getStore() ?? null;
}
