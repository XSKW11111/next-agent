import { describe, expect, test } from "vitest";
import { parse } from "../domain/parse";
import { orderEmailSchema } from "../domain/order";
import { debugOrderCatalog } from "./debug-catalog";

describe("debugOrderCatalog", () => {
  test("order-outage returns unavailable for any email", async () => {
    const catalog = debugOrderCatalog("order-outage");
    const email = parse(orderEmailSchema, "jane.smith@example.com");
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    await expect(catalog.listOrdersForEmail(email.value)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  test("email-orders lists two orders for the fixture address", async () => {
    const catalog = debugOrderCatalog("email-orders");
    const email = parse(orderEmailSchema, "jane.smith@example.com");
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    const listing = await catalog.listOrdersForEmail(email.value);
    expect(listing).toEqual({
      kind: "ready",
      orders: [
        {
          orderNumber: "#W002",
          status: "in-transit",
          trackingNumber: "TRK002",
        },
        {
          orderNumber: "#W003",
          status: "processing",
          trackingNumber: null,
        },
      ],
    });
  });

  test("email-orders returns no orders for another address", async () => {
    const catalog = debugOrderCatalog("email-orders");
    const email = parse(orderEmailSchema, "other@example.com");
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    await expect(catalog.listOrdersForEmail(email.value)).resolves.toEqual({
      kind: "ready",
      orders: [],
    });
  });
});
