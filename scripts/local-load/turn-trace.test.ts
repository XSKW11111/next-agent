import { expect, test } from "vitest";
import { createTurnTrace } from "./turn-trace";

test("records intent, tool, result, and spans without prompt content", async () => {
  const trace = createTurnTrace("request-1", "product_search");
  await trace.span("model.complete", async () => "done");
  trace.countModelCall({ messages: [{ role: "user", content: "private customer text" }] }, { text: "private reply" });
  trace.recordTool("search_products", "products_found");
  const record = trace.snapshot("ok");
  expect(record.intent).toBe("product_search");
  expect(record.tool).toBe("search_products");
  expect(record.resultKind).toBe("products_found");
  expect(record.spans[0]?.name).toBe("model.complete");
  expect(record.estimatedTokens.input).toBeGreaterThan(0);
  expect(JSON.stringify(record).includes("private")).toBe(false);
});
