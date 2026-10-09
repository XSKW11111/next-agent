import { parse } from "../../domain/parse";
import {
  orderNumberSchema,
  parseOrderEmail,
  parseOrderLookup,
  type Order,
  type OrderEmail,
  type OrderLookup,
  type OrderNumber,
} from "../../domain/order";
import {
  personOffer,
  sessionIdSchema,
  type SessionId,
  type UnmatchedOrderStreak,
} from "../../domain/session";

const trackingUrlPrefix = "https://track.example/";
const missMessage = "No order matches that number.";

const unavailable = {
  kind: "service_unavailable",
  tool: "lookup_order",
} as const;

export type CatalogOrder = {
  readonly orderNumber: OrderNumber;
  readonly status: string;
  readonly trackingNumber: string | null;
};

export type CatalogListing =
  | { readonly kind: "ready"; readonly orders: readonly CatalogOrder[] }
  | { readonly kind: "unavailable" };

export interface OrderCatalog {
  listOrdersForEmail(email: OrderEmail): Promise<CatalogListing>;
}

export type StreakRead =
  | { readonly kind: "ready"; readonly streak: UnmatchedOrderStreak }
  | { readonly kind: "unavailable" };

export type StreakWrite = { readonly kind: "ready" } | { readonly kind: "unavailable" };

export interface OrderStreakStore {
  read(sessionId: SessionId): Promise<StreakRead>;
  write(sessionId: SessionId, streak: UnmatchedOrderStreak): Promise<StreakWrite>;
}

type BusinessLookup = Exclude<OrderLookup, { readonly kind: "service_unavailable" }>;

export type LookupOrderResult =
  | (BusinessLookup & {
      readonly unmatched_order_count: UnmatchedOrderStreak;
      readonly handoff_eligible: boolean;
    })
  | typeof unavailable;

export type LookupOrderRequest = {
  readonly sessionId: unknown;
  readonly email: unknown;
  readonly orderNumber?: unknown;
};

function bump(streak: UnmatchedOrderStreak): UnmatchedOrderStreak {
  switch (streak) {
    case 0:
      return 1;
    case 1:
      return 2;
    case 2:
      return 2;
    default: {
      const exhaustive: never = streak;
      return exhaustive;
    }
  }
}

function trackingFor(trackingNumber: string | null): Order["tracking"] {
  if (trackingNumber === null) {
    return { kind: "untracked" };
  }
  const number = trackingNumber.trim();
  if (number.length === 0) {
    return { kind: "untracked" };
  }
  return {
    kind: "tracked",
    trackingNumber: number,
    trackingUrl: `${trackingUrlPrefix}${encodeURIComponent(number)}`,
  };
}

function maskOrderNumber(orderNumber: OrderNumber): string {
  return `***${orderNumber.slice(-2)}`;
}

function present(order: CatalogOrder): {
  readonly orderNumber: OrderNumber;
  readonly status: string;
  readonly tracking: Order["tracking"];
} {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    tracking: trackingFor(order.trackingNumber),
  };
}

function handoffEligible(streak: UnmatchedOrderStreak): boolean {
  return personOffer(streak).kind === "person_offer";
}

function withStreak(lookup: BusinessLookup, streak: UnmatchedOrderStreak): LookupOrderResult {
  return {
    ...lookup,
    unmatched_order_count: streak,
    handoff_eligible: handoffEligible(streak),
  };
}

function listed(orders: readonly CatalogOrder[], orderNumber: OrderNumber | undefined): unknown {
  if (orderNumber === undefined) {
    if (orders.length === 0) {
      return { kind: "order_not_found", message: missMessage, otherOrders: [] };
    }
    return { kind: "orders_found", orders: orders.map(present) };
  }
  const matched = orders.find((order) => order.orderNumber === orderNumber);
  if (matched === undefined) {
    return {
      kind: "order_not_found",
      message: missMessage,
      otherOrders: orders.map((order) => ({ orderNumber: maskOrderNumber(order.orderNumber) })),
    };
  }
  return { kind: "orders_found", orders: [present(matched)] };
}

export async function lookupOrder(
  catalog: OrderCatalog,
  streaks: OrderStreakStore,
  request: LookupOrderRequest,
): Promise<LookupOrderResult> {
  const session = parse(sessionIdSchema, request.sessionId);
  const email = parseOrderEmail(request.email);
  const orderNumber =
    request.orderNumber === undefined ? undefined : parse(orderNumberSchema, request.orderNumber);
  if (!session.ok || !email.ok || (orderNumber !== undefined && !orderNumber.ok)) {
    return unavailable;
  }

  const streakRead = await streaks.read(session.value);
  if (streakRead.kind === "unavailable") {
    return unavailable;
  }

  const listing = await catalog.listOrdersForEmail(email.value);
  if (listing.kind === "unavailable") {
    return unavailable;
  }

  const parsed = parseOrderLookup(
    listed(listing.orders, orderNumber === undefined ? undefined : orderNumber.value),
  );
  if (!parsed.ok || parsed.value.kind === "service_unavailable") {
    return unavailable;
  }

  const matched = parsed.value.kind === "orders_found";
  const streak = matched ? 0 : bump(streakRead.streak);
  const written = await streaks.write(session.value, streak);
  if (written.kind === "unavailable") {
    return unavailable;
  }
  return withStreak(parsed.value, streak);
}
