const liveTrialCount = 5;

export type PassAtKScore = {
  readonly trials: number;
  readonly passed: number;
  readonly passAt1: number;
  readonly passAt3: number;
  readonly passAll1: number;
  readonly passAll3: number;
};

export function scoreTrials(passed: number, trials = liveTrialCount): PassAtKScore {
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error("trial count must be a positive integer");
  }
  if (!Number.isInteger(passed) || passed < 0 || passed > trials) {
    throw new Error("passed count must be an integer from 0 through the trial count");
  }
  return {
    trials,
    passed,
    passAt1: passAt(trials, passed, 1),
    passAt3: passAt(trials, passed, 3),
    passAll1: passAll(trials, passed, 1),
    passAll3: passAll(trials, passed, 3),
  };
}

export function passAt(trials: number, passed: number, k: number): number {
  if (k > trials) return 0;
  const failures = trials - passed;
  if (failures < k) return 1;
  return ratio(combinations(trials, k) - combinations(failures, k), combinations(trials, k));
}

export function passAll(trials: number, passed: number, k: number): number {
  if (passed < k || k > trials) return 0;
  return ratio(combinations(passed, k), combinations(trials, k));
}

function ratio(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1e10) / 1e10;
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let index = 1; index <= k; index += 1) {
    value = (value * (n - k + index)) / index;
  }
  return value;
}
