import { expect, test } from "vitest";
import { parseOrderEmail, parseOrderLookup } from "./order";

test("parseOrderLookup accepts a found order and normalizes its number", () => {
  expect(
    parseOrderLookup({
      kind: "orders_found",
      orders: [
        {
          orderNumber: " ab12 ",
          status: " shipped ",
          tracking: {
            kind: "tracked",
            trackingNumber: " 1Z ",
            trackingUrl: "https://track.example/1Z",
          },
        },
      ],
    }),
  ).toEqual({
    ok: true,
    value: {
      kind: "orders_found",
      orders: [
        {
          orderNumber: "#AB12",
          status: "shipped",
          tracking: {
            kind: "tracked",
            trackingNumber: "1Z",
            trackingUrl: "https://track.example/1Z",
          },
        },
      ],
    },
  });
});

test("parseOrderLookup rejects an empty found list", () => {
  expect(
    parseOrderLookup({
      kind: "orders_found",
      orders: [],
      handoffEligible: true,
    }),
  ).toEqual({ ok: false });
});

test("parseOrderLookup accepts a miss and an outage, and rejects the other tool", () => {
  expect(
    parseOrderLookup({
      kind: "order_not_found",
      message: " No order ",
      otherOrders: [{ orderNumber: "***12" }],
    }),
  ).toEqual({
    ok: true,
    value: {
      kind: "order_not_found",
      message: "No order",
      otherOrders: [{ orderNumber: "***12" }],
    },
  });
  expect(parseOrderLookup({ kind: "service_unavailable", tool: "lookup_order" })).toEqual({
    ok: true,
    value: { kind: "service_unavailable", tool: "lookup_order" },
  });
  expect(
    parseOrderLookup({ kind: "service_unavailable", tool: "claim_early_risers" }),
  ).toEqual({ ok: false });
});

test("parseOrderEmail lowercases an order-search address", () => {
  expect(parseOrderEmail(" Ada@Example.com ")).toEqual({
    ok: true,
    value: "ada@example.com",
  });
});
