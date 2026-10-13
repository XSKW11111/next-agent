import { expect, test } from "vitest";
import { customerToolCards } from "./customer-tool-cards";

const ordersFound = {
  kind: "orders_found",
  orders: [
    {
      orderNumber: "#W002",
      status: "shipped",
      tracking: {
        kind: "tracked",
        trackingNumber: "1Z",
        trackingUrl: "https://track.example/1Z",
      },
    },
  ],
  unmatched_order_count: 0,
  handoff_eligible: false,
};

const productsFound = {
  kind: "products_found",
  mode: "semantic",
  matchQuality: "strong",
  absent: false,
  filtersApplied: {},
  catalogFields: ["name", "stockLevel"],
  missingFields: ["price", "size", "color", "rating", "stock-keeping code"],
  products: [
    { name: "Camp Mug", stockLevel: 4 },
    { name: "Spare Lid", stockLevel: 1 },
  ],
  alternatives: [{ name: "Weak Lantern", stockLevel: 2 }],
};

const promotionEligible = {
  kind: "promotion_eligible",
  campaign: "Early Risers",
  code: "EARLY-AAAAAAAA",
  discountPercent: 10,
  validOn: "2026-10-08",
  expiresAt: "2026-10-09T00:00:00-05:00",
  timezone: "America/Chicago",
};

const handoffProposed = {
  kind: "handoff_proposed",
  draft: {
    contactEmail: "person@example.com",
    reason: "I need a person",
    orderNumber: "#AB12",
  },
};

test("an orders_found payload keeps the order number, status, and tracked url", () => {
  expect(customerToolCards([ordersFound])).toEqual([
    {
      kind: "orders",
      orders: [
        {
          orderNumber: "#W002",
          status: "shipped",
          trackingUrl: "https://track.example/1Z",
        },
      ],
    },
  ]);
});

test("a products_found payload keeps name and stock from products", () => {
  expect(customerToolCards([productsFound])).toEqual([
    {
      kind: "products",
      products: [
        { name: "Camp Mug", stockLevel: 4 },
        { name: "Spare Lid", stockLevel: 1 },
      ],
    },
  ]);
});

test("a promotion_eligible payload keeps the Early Risers code and validOn", () => {
  expect(customerToolCards([promotionEligible])).toEqual([
    { kind: "early_risers", code: "EARLY-AAAAAAAA", validOn: "2026-10-08" },
  ]);
});

test("a handoff_proposed payload produces no card", () => {
  expect(customerToolCards([handoffProposed])).toEqual([]);
});

test("an untracked order omits the tracking url and an empty product list uses alternatives", () => {
  expect(
    customerToolCards([
      {
        kind: "orders_found",
        orders: [
          {
            orderNumber: "#W003",
            status: "processing",
            tracking: { kind: "untracked" },
          },
        ],
        unmatched_order_count: 2,
        handoff_eligible: true,
      },
      {
        kind: "products_found",
        products: [],
        alternatives: [{ name: "Weak Lantern", stockLevel: 2 }],
      },
    ]),
  ).toEqual([
    { kind: "orders", orders: [{ orderNumber: "#W003", status: "processing" }] },
    { kind: "products", products: [{ name: "Weak Lantern", stockLevel: 2 }] },
  ]);
});

test("ineligible, not-found, outage, and empty product lists produce no card", () => {
  expect(
    customerToolCards([
      { kind: "promotion_ineligible", reason: "timezone_unresolved" },
      { kind: "order_not_found", message: "No order matches that number.", otherOrders: [] },
      { kind: "service_unavailable", tool: "lookup_order" },
      { kind: "products_found", products: [], alternatives: [] },
      { kind: "orders_found", orders: [] },
      null,
      "orders_found",
    ]),
  ).toEqual([]);
});
