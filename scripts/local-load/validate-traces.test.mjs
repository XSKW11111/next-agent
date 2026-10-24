import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const runDir = mkdtempSync(join(tmpdir(), "next-agent-traces-"));
after(() => rmSync(runDir, { recursive: true, force: true }));

function validate(agentTraces) {
  writeFileSync(join(runDir, "load.jsonl"), [
    { event: "local_load.traffic", traceId: "request-1", outcome: "ok", estimatedTokens: { input: 4, output: 2 } },
    { event: "local_load.summary", requested: 1, successes: 1 },
  ].map(JSON.stringify).join("\n"));
  writeFileSync(join(runDir, "agent.jsonl"), agentTraces.map(JSON.stringify).join("\n"));
  const result = spawnSync(process.execPath, ["scripts/local-load/validate-traces.mjs", runDir], { encoding: "utf8" });
  return { status: result.status, report: JSON.parse(result.stdout.trim()) };
}

test("reconciles one traffic record to one matching agent trace", () => {
  assert.deepEqual(validate([{ event: "local_load.agent_trace", traceId: "request-1", outcome: "ok",
    estimatedTokens: { input: 4, output: 2 } }]), {
    status: 0,
    report: { event: "local_load.reconciliation", valid: true, trafficRecords: 1, agentTraces: 1,
      missingAgentTraces: [], unpairedAgentTraces: [], mismatchedTokens: [], mismatchedOutcomes: [] },
  });
});

test("rejects missing and duplicate traces", () => {
  assert.equal(validate([]).status, 1);
  assert.equal(validate([
    { event: "local_load.agent_trace", traceId: "request-1", outcome: "ok", estimatedTokens: { input: 4, output: 2 } },
    { event: "local_load.agent_trace", traceId: "request-1", outcome: "ok", estimatedTokens: { input: 4, output: 2 } },
  ]).status, 1);
});

test("rejects a trace with a different outcome", () => {
  const result = validate([{ event: "local_load.agent_trace", traceId: "request-1", outcome: "error",
    estimatedTokens: { input: 4, output: 2 } }]);
  assert.equal(result.status, 1);
  assert.deepEqual(result.report.mismatchedOutcomes, ["request-1"]);
});
