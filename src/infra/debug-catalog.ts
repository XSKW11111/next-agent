import { orderNumberSchema, type OrderEmail } from "../domain/order";
import { parse } from "../domain/parse";
import type { CatalogListing, CatalogOrder, OrderCatalog } from "../service/business/order/lookup-order";

export type DebugOrderCase = "order-outage" | "email-orders" | "hosted-default";

const emailOrdersAddress = "jane.smith@example.com";

/**
 * Debug-only order catalogs for eval fixtures the hosted Supabase catalog cannot guarantee.
 */
export function debugOrderCatalog(caseId: DebugOrderCase): OrderCatalog {
  switch (caseId) {
    case "order-outage":
      return {
        async listOrdersForEmail(): Promise<CatalogListing> {
          return { kind: "unavailable" };
        },
      };
    case "email-orders":
      return {
        async listOrdersForEmail(email: OrderEmail): Promise<CatalogListing> {
          if (email !== emailOrdersAddress) {
            return { kind: "ready", orders: [] };
          }
          return { kind: "ready", orders: emailOrdersFixture() };
        },
      };
    case "hosted-default":
      return {
        async listOrdersForEmail(): Promise<CatalogListing> {
          return { kind: "ready", orders: [] };
        },
      };
    default: {
      const unexpected: never = caseId;
      return unexpected;
    }
  }
}

function emailOrdersFixture(): readonly CatalogOrder[] {
  return [order("#W002", "in-transit", "TRK002"), order("#W003", "processing", null)];
}

function order(
  numberText: string,
  status: string,
  trackingNumber: string | null,
): CatalogOrder {
  const parsed = parse(orderNumberSchema, numberText);
  if (!parsed.ok) throw new Error(`debug catalog order number is invalid: ${numberText}`);
  return {
    orderNumber: parsed.value,
    status,
    trackingNumber,
  };
}
