import { readFileSync } from "node:fs";
import { join } from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: node validate-traces.mjs <run-directory>");

function records(file) {
  return readFileSync(join(runDir, file), "utf8").split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

const traffic = records("load.jsonl").filter((record) => record.event === "local_load.traffic");
const summaries = records("load.jsonl").filter((record) => record.event === "local_load.summary");
const traces = records("agent.jsonl").filter((record) => record.event === "local_load.agent_trace");
const trafficIds = new Set(traffic.map((record) => record.traceId));
const traceIds = new Set(traces.map((record) => record.traceId));
const missingAgentTraces = [...trafficIds].filter((id) => !traceIds.has(id));
const unpairedAgentTraces = [...traceIds].filter((id) => !trafficIds.has(id));
const mismatchedTokens = traffic.filter((record) => {
  if (record.outcome !== "ok") return false;
  const trace = traces.find((candidate) => candidate.traceId === record.traceId);
  return trace && (trace.estimatedTokens?.input !== record.estimatedTokens?.input ||
    trace.estimatedTokens?.output !== record.estimatedTokens?.output);
}).map((record) => record.traceId);
const mismatchedOutcomes = traffic.filter((record) => {
  const trace = traces.find((candidate) => candidate.traceId === record.traceId);
  return trace && trace.outcome !== record.outcome;
}).map((record) => record.traceId);
const summary = summaries[0];
const valid = summaries.length === 1 && traffic.length === summary?.requested &&
  traffic.length === trafficIds.size && traces.length === traceIds.size &&
  missingAgentTraces.length === 0 && unpairedAgentTraces.length === 0 && mismatchedTokens.length === 0 &&
  mismatchedOutcomes.length === 0 &&
  traffic.filter((record) => record.outcome === "ok").length === summary.successes;

process.stdout.write(`${JSON.stringify({ event: "local_load.reconciliation", valid,
  trafficRecords: traffic.length, agentTraces: traces.length,
  missingAgentTraces, unpairedAgentTraces, mismatchedTokens, mismatchedOutcomes })}\n`);
if (!valid) process.exitCode = 1;
