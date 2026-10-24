import { performance } from "node:perf_hooks";
import { getEncoding } from "js-tiktoken";

const encoder = getEncoding("cl100k_base");

export type SpanName = "model.complete" | "redis.get" | "redis.set" | "sqlite.sessions" | "sqlite.streak" | "sqlite.messages";
type Span = { readonly name: SpanName; readonly durationMs: number; readonly status: "ok" | "error" };

export function createTurnTrace(requestId: string) {
  const spans: Span[] = [];
  const tokens = { input: 0, output: 0 };
  return {
    async span<T>(name: SpanName, operation: () => Promise<T>): Promise<T> {
      const started = performance.now();
      try {
        const result = await operation();
        if (spans.length < 16) spans.push({ name, durationMs: performance.now() - started, status: "ok" });
        return result;
      } catch (error) {
        if (spans.length < 16) spans.push({ name, durationMs: performance.now() - started, status: "error" });
        throw error;
      }
    },
    countModelCall(input: unknown, output: unknown): void {
      tokens.input += encoder.encode(JSON.stringify(input)).length;
      tokens.output += encoder.encode(JSON.stringify(output)).length;
    },
    snapshot(outcome: "ok" | "error") {
      return {
        event: "local_load.agent_trace",
        traceId: requestId,
        recordedAt: new Date().toISOString(),
        pod: process.env.HOSTNAME ?? "unknown",
        outcome,
        spans,
        estimatedTokens: { tokenizer: "cl100k_base", input: tokens.input, output: tokens.output },
      };
    },
  };
}

export type TurnTrace = ReturnType<typeof createTurnTrace>;
