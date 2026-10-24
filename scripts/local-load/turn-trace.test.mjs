import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnTrace } from "./turn-trace.ts";

test("keeps prompt content out of the request trace", async () => {
  const trace = createTurnTrace("request-1");
  await trace.span("model.complete", async () => "done");
  trace.countModelCall({ messages: [{ role: "user", content: "private customer text" }] },
    { text: "private assistant text" });
  const record = trace.snapshot("ok");
  assert.equal(record.traceId, "request-1");
  assert.equal(record.spans[0]?.name, "model.complete");
  assert.ok(record.estimatedTokens.input > 0);
  assert.ok(record.estimatedTokens.output > 0);
  assert.equal(JSON.stringify(record).includes("private"), false);
});
