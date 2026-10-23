import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { expectedReply, type CacheOutcome } from "./agent-turn";

const requested = Number(process.env.LOAD_TURNS ?? "1000");
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? "64");
const agentUrl = process.env.AGENT_URL ?? "http://agent:3002";
const sqliteUrl = process.env.SQLITE_URL ?? "http://sqlite:3001";
if (!Number.isSafeInteger(requested) || requested < 1 || !Number.isSafeInteger(concurrency) || concurrency < 1) {
  throw new Error("LOAD_TURNS and LOAD_CONCURRENCY must be positive integers");
}

const durations: number[] = [];
const failures: string[] = [];
const outcomes: Record<CacheOutcome, number> = { hit: 0, miss: 0, unavailable: 0 };
let next = 0;
const started = performance.now();

async function worker(): Promise<void> {
  while (next < requested) {
    const index = next++;
    const requestId = randomUUID();
    const begin = performance.now();
    try {
      const response = await fetch(`${agentUrl}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null || !("reply" in result) || result.reply !== expectedReply ||
          !("sessionId" in result) || result.sessionId !== requestId || !("turnId" in result) || result.turnId !== requestId ||
          !("cacheOutcome" in result) || !["hit", "miss", "unavailable"].includes(String(result.cacheOutcome))) {
        throw new Error("incorrect turn response");
      }
      const outcome = result.cacheOutcome;
      if (outcome === "hit" || outcome === "miss" || outcome === "unavailable") outcomes[outcome]++;
      durations.push(performance.now() - begin);
    } catch (error) {
      failures.push(`${index}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requested) }, () => worker()));
const durationMs = performance.now() - started;
const statsResponse = await fetch(`${sqliteUrl}/stats`, { signal: AbortSignal.timeout(10_000) });
if (!statsResponse.ok) throw new Error(`SQLite stats returned ${statsResponse.status}`);
const sqlite: unknown = await statsResponse.json();
const sorted = [...durations].sort((a, b) => a - b);
function percentile(fraction: number): number | null {
  return sorted.length === 0 ? null : sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}
const statsValid = typeof sqlite === "object" && sqlite !== null && "sessions" in sqlite && sqlite.sessions === requested &&
  "customers" in sqlite && sqlite.customers === requested && "assistants" in sqlite && sqlite.assistants === requested &&
  "wrong_replies" in sqlite && sqlite.wrong_replies === 0;
const report = {
  requested,
  concurrency,
  successes: durations.length,
  errors: failures.length,
  failureSamples: failures.slice(0, 10),
  cache: outcomes,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: sorted.at(-1) ?? null,
  durationMs,
  turnsPerSecond: durations.length / (durationMs / 1000),
  sqlite,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (failures.length > 0 || !statsValid || outcomes.hit === 0 || outcomes.miss === 0 || outcomes.unavailable !== 0) {
  process.exitCode = 1;
}
