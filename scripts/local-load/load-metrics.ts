export type Completion = {
  readonly completedAtMs: number;
  readonly estimatedTokens: number;
};

export function peakCompletionWindow(completions: readonly Completion[]): {
  readonly completedQps: number;
  readonly estimatedTokensPerSecond: number;
} {
  const sorted = [...completions].sort((a, b) => a.completedAtMs - b.completedAtMs);
  let first = 0;
  let windowTokens = 0;
  let completedQps = 0;
  let estimatedTokensPerSecond = 0;
  for (const [index, completion] of sorted.entries()) {
    windowTokens += completion.estimatedTokens;
    while (completion.completedAtMs - (sorted[first]?.completedAtMs ?? completion.completedAtMs) >= 1000) {
      windowTokens -= sorted[first]?.estimatedTokens ?? 0;
      first++;
    }
    completedQps = Math.max(completedQps, index - first + 1);
    estimatedTokensPerSecond = Math.max(estimatedTokensPerSecond, windowTokens);
  }
  return { completedQps, estimatedTokensPerSecond };
}
