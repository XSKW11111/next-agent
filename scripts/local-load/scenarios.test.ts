import { expect, test } from "vitest";
import { scenarioForIndex, scenarioNames, validateScenarioResult } from "./scenarios";

test("1,000 requests assign exactly 250 to each intent in interleaved order", () => {
  const names = Array.from({ length: 1000 }, (_value, index) => scenarioForIndex(index).intent);
  expect(names.slice(0, 8)).toEqual([
    "order_status", "product_search", "promotion_claim", "human_handoff",
    "order_status", "product_search", "promotion_claim", "human_handoff",
  ]);
  expect(scenarioNames.map((name) => names.filter((seen) => seen === name).length)).toEqual([250, 250, 250, 250]);
});

test("each intent checks its own tool payload and answer", () => {
  for (const intent of scenarioNames) {
    const scenario = scenarioForIndex(scenarioNames.indexOf(intent));
    expect(validateScenarioResult(scenario, scenario.tool, scenario.resultKind, scenario.payload, scenario.reply)).toBe(true);
    expect(validateScenarioResult(scenario, scenario.tool, scenario.resultKind, { kind: scenario.resultKind }, scenario.reply)).toBe(false);
    expect(validateScenarioResult(scenario, scenario.tool, "service_unavailable", scenario.payload, scenario.reply)).toBe(false);
  }
});
