import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { CacheOutcome } from "./agent-turn";
import { peakCompletionWindow, type Completion } from "./load-metrics";
import { scenarioForIndex, scenarioNames, type Intent } from "./scenarios";

const requested = Number(process.env.LOAD_TURNS ?? "1000");
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? "100");
const agentUrl = process.env.AGENT_URL ?? "http://agent:3002";
const sqliteUrl = process.env.SQLITE_URL ?? "http://sqlite:3001";
if (!Number.isSafeInteger(requested) || requested < 1 || !Number.isSafeInteger(concurrency) || concurrency < 1) {
  throw new Error("LOAD_TURNS and LOAD_CONCURRENCY must be positive integers");
}
if (requested % scenarioNames.length !== 0) throw new Error("LOAD_TURNS must divide equally among four intents");

const durations: number[] = [];
const completions: Completion[] = [];
const failures: string[] = [];
const outcomes: Record<CacheOutcome, number> = { hit: 0, miss: 0, unavailable: 0, not_used: 0 };
const perIntent: Record<Intent, { attempts: number; successes: number; errors: number; durations: number[]; inputTokens: number; outputTokens: number }> = {
  order_status: { attempts: 0, successes: 0, errors: 0, durations: [], inputTokens: 0, outputTokens: 0 },
  product_search: { attempts: 0, successes: 0, errors: 0, durations: [], inputTokens: 0, outputTokens: 0 },
  promotion_claim: { attempts: 0, successes: 0, errors: 0, durations: [], inputTokens: 0, outputTokens: 0 },
  human_handoff: { attempts: 0, successes: 0, errors: 0, durations: [], inputTokens: 0, outputTokens: 0 },
};
const expectations = new Map<string, { customerText: string; reply: string }>();
const estimatedTokens = { input: 0, output: 0 };
let next = 0;
const started = performance.now();

async function worker(): Promise<void> {
  while (next < requested) {
    const index = next++;
    const scenario = scenarioForIndex(index);
    perIntent[scenario.intent].attempts++;
    const requestId = randomUUID();
    const begin = performance.now();
    let httpStatus: number | null = null;
    try {
      const response = await fetch(`${agentUrl}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, intent: scenario.intent }),
        signal: AbortSignal.timeout(30_000),
      });
      httpStatus = response.status;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null || !("reply" in result) || result.reply !== scenario.reply ||
          !("sessionId" in result) || result.sessionId !== requestId || !("turnId" in result) || result.turnId !== requestId ||
          !("intent" in result) || result.intent !== scenario.intent ||
          !("tool" in result) || result.tool !== scenario.tool ||
          !("resultKind" in result) || result.resultKind !== scenario.resultKind ||
          !("cacheOutcome" in result) || !["hit", "miss", "unavailable", "not_used"].includes(String(result.cacheOutcome)) ||
          !("traceId" in result) || result.traceId !== requestId ||
          !("estimatedTokens" in result) || typeof result.estimatedTokens !== "object" || result.estimatedTokens === null ||
          !("input" in result.estimatedTokens) || !Number.isSafeInteger(result.estimatedTokens.input) ||
          !("output" in result.estimatedTokens) || !Number.isSafeInteger(result.estimatedTokens.output) ||
          Number(result.estimatedTokens.input) < 0 || Number(result.estimatedTokens.output) < 0) {
        throw new Error("incorrect turn response");
      }
      if (scenario.intent === "order_status" ? result.cacheOutcome === "not_used" : result.cacheOutcome !== "not_used") {
        throw new Error("incorrect cache usage");
      }
      const outcome = result.cacheOutcome;
      if (outcome === "hit" || outcome === "miss" || outcome === "unavailable" || outcome === "not_used") outcomes[outcome]++;
      const durationMs = performance.now() - begin;
      const completedAtMs = performance.now() - started;
      const inputTokens = result.estimatedTokens.input;
      const outputTokens = result.estimatedTokens.output;
      if (typeof inputTokens !== "number" || typeof outputTokens !== "number") throw new Error("invalid token counts");
      estimatedTokens.input += inputTokens;
      estimatedTokens.output += outputTokens;
      perIntent[scenario.intent].successes++;
      perIntent[scenario.intent].durations.push(durationMs);
      perIntent[scenario.intent].inputTokens += inputTokens;
      perIntent[scenario.intent].outputTokens += outputTokens;
      expectations.set(requestId, { customerText: scenario.customerText, reply: scenario.reply });
      completions.push({ completedAtMs, estimatedTokens: inputTokens + outputTokens });
      durations.push(durationMs);
      process.stdout.write(`${JSON.stringify({ event: "local_load.traffic", requestId, traceId: requestId,
        intent: scenario.intent, tool: scenario.tool, resultKind: scenario.resultKind,
        completedAt: new Date().toISOString(),
        completedAtMs, durationMs, httpStatus, outcome: "ok", cacheOutcome: outcome,
        estimatedTokens: { input: inputTokens, output: outputTokens } })}\n`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      failures.push(`${index}: ${reason}`);
      perIntent[scenario.intent].errors++;
      process.stdout.write(`${JSON.stringify({ event: "local_load.traffic", requestId, traceId: requestId,
        intent: scenario.intent, tool: scenario.tool, resultKind: null,
        completedAt: new Date().toISOString(),
        completedAtMs: performance.now() - started, durationMs: performance.now() - begin,
        httpStatus, outcome: "error", reason })}\n`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requested) }, () => worker()));
const durationMs = performance.now() - started;
const statsResponse = await fetch(`${sqliteUrl}/stats`, { signal: AbortSignal.timeout(10_000) });
if (!statsResponse.ok) throw new Error(`SQLite stats returned ${statsResponse.status}`);
const sqlite: unknown = await statsResponse.json();
let wrongReplies = 0;
for (const ids of Array.from(expectations.keys()).reduce<string[][]>((batches, id, index) => {
  if (index % 500 === 0) batches.push([]);
  batches.at(-1)?.push(id);
  return batches;
}, [])) {
  const response = await fetch(`${sqliteUrl}/messages/readback`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`SQLite readback returned ${response.status}`);
  const records: unknown = await response.json();
  if (!Array.isArray(records) || records.length !== ids.length) throw new Error("SQLite readback count mismatch");
  for (const row of records) {
    if (typeof row !== "object" || row === null || !("id" in row) || typeof row.id !== "string") { wrongReplies++; continue; }
    const expected = expectations.get(row.id);
    if (expected === undefined || !("customerText" in row) || row.customerText !== expected.customerText ||
        !("reply" in row) || row.reply !== expected.reply) wrongReplies++;
  }
}
const sorted = [...durations].sort((a, b) => a - b);
function percentile(fraction: number): number | null {
  return sorted.length === 0 ? null : sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}
const statsValid = typeof sqlite === "object" && sqlite !== null && "sessions" in sqlite && sqlite.sessions === requested &&
  "customers" in sqlite && sqlite.customers === requested && "assistants" in sqlite && sqlite.assistants === requested &&
  expectations.size === durations.length && wrongReplies === 0;
const report = {
  event: "local_load.summary",
  requested,
  concurrency,
  successes: durations.length,
  errors: failures.length,
  failureSamples: failures.slice(0, 10),
  cache: outcomes,
  intents: Object.fromEntries(scenarioNames.map((intent) => {
    const group = perIntent[intent];
    const sortedDurations = [...group.durations].sort((a, b) => a - b);
    return [intent, { attempts: group.attempts, successes: group.successes, errors: group.errors,
      p50Ms: sortedDurations[Math.ceil(sortedDurations.length * 0.5) - 1] ?? null,
      p95Ms: sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1] ?? null,
      estimatedTokens: { input: group.inputTokens, output: group.outputTokens } }];
  })),
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: sorted.at(-1) ?? null,
  durationMs,
  turnsPerSecond: durations.length / (durationMs / 1000),
  peak: peakCompletionWindow(completions),
  estimatedTokens: { tokenizer: "cl100k_base", ...estimatedTokens,
    total: estimatedTokens.input + estimatedTokens.output, providerUsage: "not applicable" },
  sqlite: typeof sqlite === "object" && sqlite !== null
    ? { ...sqlite, checked_pairs: expectations.size, wrong_replies: wrongReplies }
    : { checked_pairs: expectations.size, wrong_replies: wrongReplies },
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (failures.length > 0 || !statsValid || outcomes.hit === 0 || outcomes.miss === 0 || outcomes.unavailable !== 0 ||
    scenarioNames.some((intent) => perIntent[intent].attempts !== requested / scenarioNames.length || perIntent[intent].errors !== 0)) {
  process.exitCode = 1;
}
