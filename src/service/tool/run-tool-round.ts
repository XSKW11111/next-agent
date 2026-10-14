import { executeToolChunk } from "./execute-tool-chunk";
import {
  maxCallsPerChunk,
  planToolChunk,
  type ToolCall,
  type ToolName,
} from "./tool-chunk-plan";

export type { ToolCall, ToolName };

export type ToolRound<Result> =
  | { readonly ok: true; readonly results: readonly Result[] }
  | { readonly ok: false; readonly reason: "too_many_calls" };

export async function runToolRound<Result>(
  calls: readonly ToolCall<Result>[],
): Promise<ToolRound<Result>> {
  if (calls.length > maxCallsPerChunk) {
    return { ok: false, reason: "too_many_calls" };
  }

  const plan = planToolChunk(calls.map((call) => call.tool));
  return { ok: true, results: await executeToolChunk(calls, plan) };
}
