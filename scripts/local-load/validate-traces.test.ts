import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";

const runDir = mkdtempSync(join(tmpdir(), "next-agent-traces-"));
afterAll(() => rmSync(runDir, { recursive: true, force: true }));

function validate(traces: readonly unknown[]) {
  const traffic = [
    { event: "local_load.traffic", traceId: "request-1", intent: "order_status", tool: "lookup_order",
      resultKind: "orders_found", outcome: "ok", estimatedTokens: { input: 4, output: 2 } },
    { event: "local_load.traffic", traceId: "request-2", intent: "product_search", tool: "search_products",
      resultKind: "products_found", outcome: "ok", estimatedTokens: { input: 4, output: 2 } },
    { event: "local_load.traffic", traceId: "request-3", intent: "promotion_claim", tool: "claim_early_risers",
      resultKind: "promotion_eligible", outcome: "ok", estimatedTokens: { input: 4, output: 2 } },
    { event: "local_load.traffic", traceId: "request-4", intent: "human_handoff", tool: "capture_handoff",
      resultKind: "handoff_proposed", outcome: "ok", estimatedTokens: { input: 4, output: 2 } },
    { event: "local_load.summary", requested: 4, successes: 4 },
  ];
  writeFileSync(join(runDir, "load.jsonl"), traffic.map((record) => JSON.stringify(record)).join("\n"));
  writeFileSync(join(runDir, "agent.jsonl"), traces.map((record) => JSON.stringify(record)).join("\n"));
  const result = spawnSync(process.execPath, ["scripts/local-load/validate-traces.mjs", runDir], { encoding: "utf8" });
  return { status: result.status, report: JSON.parse(result.stdout.trim()) };
}

const goodTraces = [
  { event: "local_load.agent_trace", traceId: "request-1", intent: "order_status", tool: "lookup_order", resultKind: "orders_found" },
  { event: "local_load.agent_trace", traceId: "request-2", intent: "product_search", tool: "search_products", resultKind: "products_found" },
  { event: "local_load.agent_trace", traceId: "request-3", intent: "promotion_claim", tool: "claim_early_risers", resultKind: "promotion_eligible" },
  { event: "local_load.agent_trace", traceId: "request-4", intent: "human_handoff", tool: "capture_handoff", resultKind: "handoff_proposed" },
].map((trace) => ({ ...trace, outcome: "ok", estimatedTokens: { input: 4, output: 2 } }));

test("reconciles one trace for each equally represented intent", () => {
  expect(validate(goodTraces)).toEqual({ status: 0, report: {
    event: "local_load.reconciliation", valid: true, trafficRecords: 4, agentTraces: 4,
    missingAgentTraces: [], unpairedAgentTraces: [], mismatchedTokens: [], mismatchedOutcomes: [],
    mismatchedScenarios: [], balanced: true,
  } });
});

test("rejects a trace that reports the wrong tool", () => {
  const result = validate(goodTraces.map((trace) => trace.traceId === "request-2" ? { ...trace, tool: "lookup_order" } : trace));
  expect(result.status).toBe(1);
  expect(result.report.mismatchedScenarios).toEqual(["request-2"]);
});

test("rejects duplicate and missing traces", () => {
  expect(validate([...goodTraces, goodTraces[0]]).status).toBe(1);
  expect(validate(goodTraces.slice(1)).status).toBe(1);
});
