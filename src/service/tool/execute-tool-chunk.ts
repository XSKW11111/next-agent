import type { ToolCall, ToolChunkPlan } from "./tool-chunk-plan";

export async function executeToolChunk<Result>(
  calls: readonly ToolCall<Result>[],
  plan: ToolChunkPlan,
): Promise<readonly Result[]> {
  if (plan.calls.length !== calls.length) {
    throw new Error("chunk plan does not match the calls");
  }

  const results = new Array<Result>(calls.length);
  const finished = plan.calls.map(() => gate());

  await Promise.all(
    plan.calls.map(async (step) => {
      await Promise.all(step.waitsFor.map((index) => finishedGate(finished, index)));
      const call = calls[step.index];
      const done = finished[step.index];
      if (call === undefined || done === undefined) {
        throw new Error("chunk plan names a missing call");
      }
      results[step.index] = await call.run();
      done.resolve();
    }),
  );

  return results;
}

type Gate = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function gate(): Gate {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  if (resolve === undefined) throw new Error("chunk gate did not open");
  return { promise, resolve };
}

function finishedGate(finished: readonly Gate[], index: number): Promise<void> {
  const gateAt = finished[index];
  if (gateAt === undefined) throw new Error("chunk plan waits for a missing call");
  return gateAt.promise;
}
