import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { peakCompletionWindow } from "./load-metrics.ts";

describe("peakCompletionWindow", () => {
  it("counts completions and estimated tokens within a rolling second", () => {
    assert.deepEqual(peakCompletionWindow([
      { completedAtMs: 0, estimatedTokens: 10 },
      { completedAtMs: 999, estimatedTokens: 20 },
      { completedAtMs: 1000, estimatedTokens: 30 },
      { completedAtMs: 2001, estimatedTokens: 40 },
    ]), { completedQps: 2, estimatedTokensPerSecond: 50 });
  });

  it("returns zero for an empty run and includes failures only when supplied", () => {
    assert.deepEqual(peakCompletionWindow([]), { completedQps: 0, estimatedTokensPerSecond: 0 });
    assert.deepEqual(peakCompletionWindow([{ completedAtMs: 4, estimatedTokens: 0 }]),
      { completedQps: 1, estimatedTokensPerSecond: 0 });
  });
});
