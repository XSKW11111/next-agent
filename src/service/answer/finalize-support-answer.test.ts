import { expect, test } from "vitest";
import { finalizeSupportAnswer, isUnsafeSentence } from "./finalize-support-answer";

const outageSentence = "That service is temporarily unavailable.";
const emptyModelSentence = "Something was wrong with the model output, Please try again";

test("replaces the draft when every payload is an outage", () => {
  expect(
    finalizeSupportAnswer({
      draft: "Your order #W002 shipped.",
      toolPayloads: [
        { kind: "service_unavailable", tool: "lookup_order" },
        { kind: "service_unavailable", tool: "search_products" },
      ],
    }),
  ).toBe(outageSentence);
});

test("puts the outage sentence before the kept draft", () => {
  expect(
    finalizeSupportAnswer({
      draft: "Order #W002 has shipped.",
      toolPayloads: [
        { kind: "service_unavailable", tool: "search_products" },
        { kind: "orders_found", orders: [{ orderNumber: "#W002" }] },
      ],
    }),
  ).toBe(`${outageSentence} Order #W002 has shipped.`);
});

test("removes an invented Early Risers code and keeps the rest", () => {
  expect(
    finalizeSupportAnswer({
      draft: "Early Risers is 10% off from 08:00-10:00. Your code is EARLY-ZZZZ9999.",
      toolPayloads: [
        {
          kind: "promotion_ineligible",
          reason: "outside_window",
          window: "08:00-10:00",
        },
      ],
    }),
  ).toBe("Early Risers is 10% off from 08:00-10:00.");
});

test("keeps an Early Risers code the tool issued", () => {
  expect(
    finalizeSupportAnswer({
      draft: "Your code is EARLY-ABCD1234.",
      toolPayloads: [{ kind: "promotion_eligible", code: "EARLY-ABCD1234" }],
    }),
  ).toBe("Your code is EARLY-ABCD1234.");
});

test("removes a UUID the tools did not return", () => {
  const issued = "11111111-1111-4111-8111-111111111111";
  const invented = "22222222-2222-4222-8222-222222222222";
  expect(
    finalizeSupportAnswer({
      draft: `Your case is ${issued}. Also see ${invented}.`,
      toolPayloads: [{ kind: "handoff_proposed", caseId: issued }],
    }),
  ).toBe(`Your case is ${issued}.`);
});

test("replaces an empty draft when nothing is down", () => {
  expect(
    finalizeSupportAnswer({
      draft: "   ",
      toolPayloads: [{ kind: "orders_found", orders: [] }],
    }),
  ).toBe(emptyModelSentence);
});

test("replaces a draft whose sentences are all unsafe", () => {
  expect(
    finalizeSupportAnswer({
      draft: "Check the database. Code EARLY-NOPE1234.",
      toolPayloads: [{ kind: "orders_found" }],
    }),
  ).toBe(emptyModelSentence);
});

test("keeps only the outage sentence when the draft is all unsafe", () => {
  expect(
    finalizeSupportAnswer({
      draft: "The redis cache failed.",
      toolPayloads: [
        { kind: "service_unavailable", tool: "lookup_order" },
        { kind: "orders_found" },
      ],
    }),
  ).toBe(outageSentence);
});

test("does not treat a model hint as an issued code", () => {
  expect(
    finalizeSupportAnswer({
      draft: "Your code is EARLY-HINT1234.",
      toolPayloads: [
        {
          kind: "orders_found",
          unmatched_order_count: "EARLY-HINT1234",
          handoff_eligible: true,
        },
      ],
    }),
  ).toBe(emptyModelSentence);
});

test("isUnsafeSentence rejects an invented code and accepts an issued one", () => {
  expect(isUnsafeSentence("Use EARLY-NOPE1234 today.", [])).toBe(true);
  expect(
    isUnsafeSentence("Use EARLY-ABCD1234 today.", [{ code: "EARLY-ABCD1234" }]),
  ).toBe(false);
});
