const maxCallsPerRound = 8;

type ToolPolicy =
  | { readonly kind: "parallel" }
  | {
      readonly kind: "serial";
      readonly lane: "order-resolution" | "handoff-create";
    };

const toolPolicy = {
  lookup_order: { kind: "serial", lane: "order-resolution" },
  search_products: { kind: "parallel" },
  claim_early_risers: { kind: "parallel" },
  capture_handoff: { kind: "serial", lane: "handoff-create" },
} as const satisfies Record<string, ToolPolicy>;

export type ToolName = keyof typeof toolPolicy;

export type ToolCall<Result> = {
  readonly tool: ToolName;
  readonly run: () => Promise<Result>;
};

export type ToolRound<Result> =
  | { readonly ok: true; readonly results: readonly Result[] }
  | { readonly ok: false; readonly reason: "too_many_calls" };

function laneKey(tool: ToolName, index: number): string {
  const policy = toolPolicy[tool];
  switch (policy.kind) {
    case "parallel":
      return `parallel:${index}`;
    case "serial":
      return policy.lane;
    default: {
      const unreachable: never = policy;
      return unreachable;
    }
  }
}

export async function runToolRound<Result>(
  calls: readonly ToolCall<Result>[],
): Promise<ToolRound<Result>> {
  if (calls.length > maxCallsPerRound) {
    return { ok: false, reason: "too_many_calls" };
  }

  const tails = new Map<string, Promise<unknown>>();
  const pending: Promise<Result>[] = [];

  for (const [index, call] of calls.entries()) {
    const key = laneKey(call.tool, index);
    const earlier = tails.get(key) ?? Promise.resolve();
    const result = earlier.then(() => call.run());
    tails.set(key, result);
    pending.push(result);
  }

  return { ok: true, results: await Promise.all(pending) };
}
