export function logStep(step: string, startedAt: number): void {
  console.info(`[turn] ${step} ${Math.round(performance.now() - startedAt)}ms`);
}
