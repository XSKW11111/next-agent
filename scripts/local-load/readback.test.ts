import { expect, test } from "vitest";
import { countWrongReadbackRows } from "./readback";

const expectations = new Map([
  ["request-a", { customerText: "Where is order W002?", reply: "Your order #W002 is shipped." }],
  ["request-b", { customerText: "Where is order W002?", reply: "Your order #W002 is shipped." }],
]);

test("rejects a duplicate readback row when two requests have the same intent", () => {
  const repeated = { id: "request-a", customerText: "Where is order W002?", reply: "Your order #W002 is shipped." };
  expect(countWrongReadbackRows(["request-a", "request-b"], [repeated, repeated], expectations)).toBe(1);
  expect(countWrongReadbackRows(["request-a", "request-b"], [repeated,
    { id: "request-b", customerText: "Where is order W002?", reply: "Your order #W002 is shipped." }], expectations)).toBe(0);
});
