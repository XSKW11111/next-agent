import type { ToolName } from "../../src/service/tool/run-tool-round";
import { parsePromotionResult } from "../../src/domain/promotion";

export const scenarioNames = ["order_status", "product_search", "promotion_claim", "human_handoff"] as const;
export type Intent = typeof scenarioNames[number];

export type Scenario = {
  readonly intent: Intent;
  readonly customerText: string;
  readonly reply: string;
  readonly tool: ToolName;
  readonly args: unknown;
  readonly resultKind: string;
  readonly payload: unknown;
};

const scenarios: readonly Scenario[] = [
  {
    intent: "order_status", customerText: "Where is order W002?", reply: "Your order #W002 is shipped.",
    tool: "lookup_order", args: { email: "ada@example.com", order_number: "W002" },
    resultKind: "orders_found", payload: { kind: "orders_found", orders: [{ orderNumber: "#W002", status: "shipped", tracking: { kind: "tracked", trackingNumber: "1Z" } }] },
  },
  {
    intent: "product_search", customerText: "Do you have a camp mug?", reply: "Camp Mug is in stock.",
    tool: "search_products", args: { mode: "semantic", query: "camp mug" },
    resultKind: "products_found", payload: { kind: "products_found", mode: "semantic", matchQuality: "strong", products: [{ name: "Camp Mug", stockLevel: 4 }] },
  },
  {
    intent: "promotion_claim", customerText: "Please claim the Early Risers discount.", reply: "Your Early Risers code is EARLY-LOCAL123 for 10% off.",
    tool: "claim_early_risers", args: { request: "claim" },
    resultKind: "promotion_eligible", payload: { kind: "promotion_eligible", campaign: "Early Risers", code: "EARLY-LOCAL123", discountPercent: 10,
      validOn: "2026-10-08", expiresAt: "2026-10-09T00:00:00+08:00", timezone: "Asia/Shanghai" },
  },
  {
    intent: "human_handoff", customerText: "Please connect me to a person at ada@example.com.", reply: "I can hand this to a person. Confirm or Cancel.",
    tool: "capture_handoff", args: { contact_email: "ada@example.com", reason: "customer asked for a person" },
    resultKind: "handoff_proposed", payload: { kind: "handoff_proposed", draft: { contactEmail: "ada@example.com", reason: "customer asked for a person" } },
  },
];

export function scenarioForIndex(index: number): Scenario {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("invalid scenario index");
  const scenario = scenarios[index % scenarios.length];
  if (scenario === undefined) throw new Error("missing scenario fixture");
  return scenario;
}

export function parseIntent(value: unknown): Intent | undefined {
  return scenarioNames.find((name) => name === value);
}

export function scenarioForIntent(intent: Intent): Scenario {
  const scenario = scenarios.find((candidate) => candidate.intent === intent);
  if (scenario === undefined) throw new Error("missing intent fixture");
  return scenario;
}

export function validateScenarioResult(scenario: Scenario, tool: ToolName, kind: unknown, payload: unknown, reply: unknown): boolean {
  return tool === scenario.tool && kind === scenario.resultKind && reply === scenario.reply &&
    containsFields(payload, scenario.payload) &&
    (scenario.intent !== "promotion_claim" || parsePromotionResult(payload).ok);
}

function containsFields(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return actual === expected;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length &&
    expected.every((value, index) => containsFields(actual[index], value));
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => {
    const found = Object.entries(actual).find(([actualKey]) => actualKey === key);
    return found !== undefined && containsFields(found[1], value);
  });
}
