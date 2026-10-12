import { describe, expect, test } from "vitest";
import { passAll, passAt, scoreTrials } from "./pass-at-k";

describe("scoreTrials", () => {
  test("five passes score 1 on every reported metric", () => {
    expect(scoreTrials(5)).toEqual({
      trials: 5,
      passed: 5,
      passAt1: 1,
      passAt3: 1,
      passAll1: 1,
      passAll3: 1,
    });
  });

  test("one pass in five matches the unbiased estimates", () => {
    expect(passAt(5, 1, 1)).toBe(0.2);
    expect(passAt(5, 1, 3)).toBe(0.6);
    expect(passAll(5, 1, 1)).toBe(0.2);
    expect(passAll(5, 1, 3)).toBe(0);
    expect(scoreTrials(1)).toMatchObject({
      passAt1: 0.2,
      passAt3: 0.6,
      passAll1: 0.2,
      passAll3: 0,
    });
  });

  test("zero passes score 0", () => {
    expect(scoreTrials(0)).toMatchObject({
      passAt1: 0,
      passAt3: 0,
      passAll1: 0,
      passAll3: 0,
    });
  });
});
