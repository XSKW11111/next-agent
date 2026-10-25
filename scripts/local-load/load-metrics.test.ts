import { expect, test } from "vitest";
import { peakCompletionWindow } from "./load-metrics";

test("counts completed requests and estimated tokens in a rolling second", () => {
  expect(peakCompletionWindow([
    { completedAtMs: 0, estimatedTokens: 10 },
    { completedAtMs: 999, estimatedTokens: 20 },
    { completedAtMs: 1000, estimatedTokens: 30 },
    { completedAtMs: 2001, estimatedTokens: 40 },
  ])).toEqual({ completedQps: 2, estimatedTokensPerSecond: 50 });
  expect(peakCompletionWindow([])).toEqual({ completedQps: 0, estimatedTokensPerSecond: 0 });
});
