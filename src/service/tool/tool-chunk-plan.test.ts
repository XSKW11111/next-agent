import { expect, test } from "vitest";
import { planToolChunk, skippedChecksSentence } from "./tool-chunk-plan";

test("a chunk of product searches has no write to wait for", () => {
  expect(planToolChunk(["search_products", "search_products"]).writeOrder).toEqual([]);
  expect(planToolChunk(["search_products", "search_products"]).calls.map((call) => call.waitsFor)).toEqual([
    [],
    [],
  ]);
});

test("writes wait for the previous write and a search waits for nobody", () => {
  const plan = planToolChunk([
    "lookup_order",
    "search_products",
    "claim_early_risers",
    "capture_handoff",
  ]);

  expect(plan.writeOrder).toEqual([0, 2, 3]);
  expect(plan.calls.map((call) => call.waitsFor)).toEqual([[], [], [0], [2]]);
  expect(plan.calls.map((call) => call.effect)).toEqual(["write", "read", "write", "write"]);
});

test("skipped checks name the tool and a descriptor when the args parse", () => {
  expect(
    skippedChecksSentence([
      { tool: "lookup_order", args: { order_number: "w002" } },
      { tool: "search_products", args: { mode: "semantic", query: " mug " } },
      { tool: "search_products", args: { mode: "list" } },
      { tool: "claim_early_risers", args: { request: "yes" } },
      {
        tool: "capture_handoff",
        args: { contact_email: "person@example.com", reason: "I need a person" },
      },
      { tool: "lookup_order", args: {} },
      { tool: "search_products", args: { mode: "semantic" } },
    ]),
  ).toBe(
    "I could not run these checks in this message: lookup_order (#W002), search_products (mode=semantic query=mug), search_products (mode=list), claim_early_risers (claim), capture_handoff (handoff), lookup_order, search_products",
  );
});
