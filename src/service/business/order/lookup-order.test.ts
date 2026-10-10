import { expect, test } from "vitest";
import { parse, type Parsed } from "../../../domain/parse";
import { orderNumberSchema, type OrderNumber } from "../../../domain/order";
import { sessionIdSchema, type SessionId, type UnmatchedOrderStreak } from "../../../domain/session";
import {
  lookupOrder,
  type CatalogOrder,
  type OrderCatalog,
  type OrderStreakStore,
} from "./lookup-order";

const sessionId = "11111111-1111-4111-8111-111111111111";

function parsed<T>(result: Parsed<T>): T {
  if (!result.ok) {
    throw new Error("test fixture did not parse");
  }
  return result.value;
}

function number(raw: string): OrderNumber {
  return parsed(parse(orderNumberSchema, raw));
}

function session(): SessionId {
  return parsed(parse(sessionIdSchema, sessionId));
}

function order(rawNumber: string, status: string, trackingNumber: string | null): CatalogOrder {
  return { orderNumber: number(rawNumber), status, trackingNumber };
}

function catalog(email: string, orders: readonly CatalogOrder[]): OrderCatalog {
  return {
    async listOrdersForEmail(requested) {
      if (requested !== email) {
        return { kind: "ready", orders: [] };
      }
      return { kind: "ready", orders };
    },
  };
}

function streaks(initial: UnmatchedOrderStreak): OrderStreakStore & {
  current(): UnmatchedOrderStreak | undefined;
} {
  const id = session();
  const counts = new Map<SessionId, UnmatchedOrderStreak>([[id, initial]]);
  return {
    async read(sessionIdToRead) {
      const streak = counts.get(sessionIdToRead);
      if (streak === undefined) {
        return { kind: "unavailable" };
      }
      return { kind: "ready", streak };
    },
    async write(sessionIdToWrite, streak) {
      if (!counts.has(sessionIdToWrite)) {
        return { kind: "unavailable" };
      }
      counts.set(sessionIdToWrite, streak);
      return { kind: "ready" };
    },
    current() {
      return counts.get(id);
    },
  };
}

test("lookupOrder lists that email's orders with full numbers", async () => {
  const store = streaks(2);
  const result = await lookupOrder(catalog("ada@example.com", [
    order("W002", "shipped", "1Z"),
    order("W003", "processing", null),
  ]), store, {
    sessionId,
    email: " Ada@Example.com ",
  });

  expect(result).toEqual({
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
      {
        orderNumber: "#W003",
        status: "processing",
        tracking: { kind: "untracked" },
      },
    ],
    unmatched_order_count: 0,
    handoff_eligible: false,
  });
  expect(store.current()).toBe(0);
});

test("lookupOrder returns the matching order and its tracking link", async () => {
  const store = streaks(1);
  const result = await lookupOrder(catalog("ada@example.com", [
    order("W002", "shipped", "1Z999"),
    order("W003", "processing", null),
  ]), store, {
    sessionId,
    email: "ada@example.com",
    orderNumber: "w002",
  });

  expect(result).toEqual({
    kind: "orders_found",
    orders: [
      {
        orderNumber: "#W002",
        status: "shipped",
        tracking: {
          kind: "tracked",
          trackingNumber: "1Z999",
          trackingUrl: "https://track.example/1Z999",
        },
      },
    ],
    unmatched_order_count: 0,
    handoff_eligible: false,
  });
  expect(store.current()).toBe(0);
});

test("lookupOrder returns a hit with no tracking link when the order has no tracking number", async () => {
  const store = streaks(0);
  const result = await lookupOrder(catalog("ada@example.com", [
    order("W003", "processing", null),
  ]), store, {
    sessionId,
    email: "ada@example.com",
    orderNumber: "#W003",
  });

  expect(result).toEqual({
    kind: "orders_found",
    orders: [
      {
        orderNumber: "#W003",
        status: "processing",
        tracking: { kind: "untracked" },
      },
    ],
    unmatched_order_count: 0,
    handoff_eligible: false,
  });
  expect(store.current()).toBe(0);
});

test("lookupOrder masks the other order numbers when the number misses", async () => {
  const store = streaks(0);
  const result = await lookupOrder(catalog("ada@example.com", [
    order("W002", "shipped", "1Z"),
    order("AB", "processing", null),
  ]), store, {
    sessionId,
    email: "ada@example.com",
    orderNumber: "W001",
  });

  expect(result).toEqual({
    kind: "order_not_found",
    message: "No order matches that number.",
    otherOrders: [{ orderNumber: "***02" }, { orderNumber: "***AB" }],
    unmatched_order_count: 1,
    handoff_eligible: false,
  });
  expect(store.current()).toBe(1);
});

test("lookupOrder moves the unmatched streak from 0 to 1 to 2", async () => {
  const store = streaks(0);
  const ports = catalog("ada@example.com", [order("W002", "shipped", "1Z")]);
  const request = { sessionId, email: "ada@example.com", orderNumber: "W001" };

  const first = await lookupOrder(ports, store, request);
  const second = await lookupOrder(ports, store, request);
  const third = await lookupOrder(ports, store, request);

  expect(first).toEqual({
    kind: "order_not_found",
    message: "No order matches that number.",
    otherOrders: [{ orderNumber: "***02" }],
    unmatched_order_count: 1,
    handoff_eligible: false,
  });
  expect(second).toEqual({
    kind: "order_not_found",
    message: "No order matches that number.",
    otherOrders: [{ orderNumber: "***02" }],
    unmatched_order_count: 2,
    handoff_eligible: true,
  });
  expect(third).toEqual({
    kind: "order_not_found",
    message: "No order matches that number.",
    otherOrders: [{ orderNumber: "***02" }],
    unmatched_order_count: 2,
    handoff_eligible: true,
  });
  expect(store.current()).toBe(2);
});

test("lookupOrder resets the streak to 0 when the order matches", async () => {
  const store = streaks(2);
  const result = await lookupOrder(catalog("ada@example.com", [
    order("W002", "shipped", "1Z"),
  ]), store, {
    sessionId,
    email: "ada@example.com",
    orderNumber: "#w002",
  });

  expect(result).toEqual({
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
  });
  expect(store.current()).toBe(0);
});

test("lookupOrder leaves the streak when the catalog is unavailable", async () => {
  const store = streaks(1);
  const down: OrderCatalog = {
    async listOrdersForEmail() {
      return { kind: "unavailable" };
    },
  };
  const result = await lookupOrder(down, store, {
    sessionId,
    email: "ada@example.com",
    orderNumber: "W002",
  });

  expect(result).toEqual({
    kind: "service_unavailable",
    tool: "lookup_order",
  });
  expect(store.current()).toBe(1);
});
