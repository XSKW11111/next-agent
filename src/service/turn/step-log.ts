import { currentTurnTraceContext } from "../../infra/langsmith/turn-trace-context";

export function logStep(step: string, startedAt: number): void {
  const ms = Math.round(performance.now() - startedAt);
  console.info(`[turn] ${step} ${ms}ms`);
  const context = currentTurnTraceContext();
  if (context !== null) {
    context.stepTimingsMs.set(step, ms);
  }
}
