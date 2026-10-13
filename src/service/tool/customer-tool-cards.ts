import { z } from "zod";
import type { SessionId } from "../../domain/session";
import type { TurnId } from "../../domain/turn";

const earlyRisersCode = z.string().regex(/^EARLY-[A-Za-z0-9]{8}$/);

const orderIdentity = z.object({
  orderNumber: z.string().trim().min(1),
  status: z.string().trim().min(1),
});

const trackedTracking = z.object({
  kind: z.literal("tracked"),
  trackingUrl: z.url(),
});

const untrackedTracking = z.object({
  kind: z.literal("untracked"),
});

const trackingSchema = z.discriminatedUnion("kind", [trackedTracking, untrackedTracking]);

const ordersEnvelope = z.object({
  kind: z.literal("orders_found"),
  orders: z.array(z.unknown()),
});

const productFact = z.object({
  name: z.string().trim().min(1),
  stockLevel: z.number().int().nonnegative(),
});

const productsEnvelope = z.object({
  kind: z.literal("products_found"),
  products: z.array(z.unknown()).optional(),
  alternatives: z.array(z.unknown()).optional(),
});

const earlyEnvelope = z.object({
  kind: z.literal("promotion_eligible"),
  code: earlyRisersCode,
  validOn: z.iso.date(),
});

export type CustomerToolCard =
  | {
      readonly kind: "orders";
      readonly orders: readonly {
        readonly orderNumber: string;
        readonly status: string;
        readonly trackingUrl?: string;
      }[];
    }
  | {
      readonly kind: "products";
      readonly products: readonly {
        readonly name: string;
        readonly stockLevel: number;
      }[];
    }
  | {
      readonly kind: "early_risers";
      readonly code: string;
      readonly validOn: string;
    };

export type ToolCardRecord = {
  readonly turnId: TurnId;
  readonly cards: readonly CustomerToolCard[];
};

export type ToolCardStore = {
  listForSession(sessionId: SessionId): readonly ToolCardRecord[];
  findForTurn(sessionId: SessionId, turnId: TurnId): readonly CustomerToolCard[] | undefined;
  save(sessionId: SessionId, turnId: TurnId, cards: readonly CustomerToolCard[]): void;
};

type OrderCard = {
  readonly orderNumber: string;
  readonly status: string;
  readonly trackingUrl?: string;
};

type ProductCard = {
  readonly name: string;
  readonly stockLevel: number;
};

export function customerToolCards(payloads: readonly unknown[]): CustomerToolCard[] {
  const cards: CustomerToolCard[] = [];
  for (const payload of payloads) {
    const card = cardFrom(payload);
    if (card !== undefined) cards.push(card);
  }
  return cards;
}

export function memoryToolCardStore(): ToolCardStore {
  const rows: {
    readonly sessionId: SessionId;
    readonly turnId: TurnId;
    readonly cards: readonly CustomerToolCard[];
  }[] = [];
  return {
    listForSession(sessionId) {
      return rows
        .filter((row) => row.sessionId === sessionId)
        .map((row) => ({ turnId: row.turnId, cards: row.cards }));
    },
    findForTurn(sessionId, turnId) {
      return rows.find((row) => row.sessionId === sessionId && row.turnId === turnId)?.cards;
    },
    save(sessionId, turnId, cards) {
      const index = rows.findIndex((row) => row.sessionId === sessionId && row.turnId === turnId);
      const next = { sessionId, turnId, cards };
      if (index === -1) {
        rows.push(next);
        return;
      }
      rows[index] = next;
    },
  };
}

function cardFrom(payload: unknown): CustomerToolCard | undefined {
  switch (payloadKind(payload)) {
    case "orders_found":
      return ordersCard(payload);
    case "products_found":
      return productsCard(payload);
    case "promotion_eligible":
      return earlyRisersCard(payload);
    default:
      return undefined;
  }
}

function payloadKind(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || !("kind" in payload)) return undefined;
  return typeof payload.kind === "string" ? payload.kind : undefined;
}

function ordersCard(payload: unknown): CustomerToolCard | undefined {
  const parsed = ordersEnvelope.safeParse(payload);
  if (!parsed.success) return undefined;
  const orders: OrderCard[] = [];
  for (const raw of parsed.data.orders) {
    const order = orderCard(raw);
    if (order !== undefined) orders.push(order);
  }
  if (orders.length === 0) return undefined;
  return { kind: "orders", orders };
}

function orderCard(raw: unknown): OrderCard | undefined {
  const identity = orderIdentity.safeParse(raw);
  if (!identity.success) return undefined;
  const tracking = trackingOf(raw);
  if (tracking === undefined) {
    return { orderNumber: identity.data.orderNumber, status: identity.data.status };
  }
  switch (tracking.kind) {
    case "tracked":
      return {
        orderNumber: identity.data.orderNumber,
        status: identity.data.status,
        trackingUrl: tracking.trackingUrl,
      };
    case "untracked":
      return { orderNumber: identity.data.orderNumber, status: identity.data.status };
    default: {
      const unexpected: never = tracking;
      return unexpected;
    }
  }
}

function trackingOf(raw: unknown): z.infer<typeof trackingSchema> | undefined {
  if (typeof raw !== "object" || raw === null || !("tracking" in raw)) return undefined;
  const parsed = trackingSchema.safeParse(raw.tracking);
  if (!parsed.success) return undefined;
  return parsed.data;
}

function productsCard(payload: unknown): CustomerToolCard | undefined {
  const parsed = productsEnvelope.safeParse(payload);
  if (!parsed.success) return undefined;
  const products = productFacts(parsed.data.products ?? []);
  const chosen = products.length > 0 ? products : productFacts(parsed.data.alternatives ?? []);
  if (chosen.length === 0) return undefined;
  return { kind: "products", products: chosen };
}

function productFacts(raw: readonly unknown[]): ProductCard[] {
  const products: ProductCard[] = [];
  for (const item of raw) {
    const parsed = productFact.safeParse(item);
    if (parsed.success) products.push(parsed.data);
  }
  return products;
}

function earlyRisersCard(payload: unknown): CustomerToolCard | undefined {
  const parsed = earlyEnvelope.safeParse(payload);
  if (!parsed.success) return undefined;
  return { kind: "early_risers", code: parsed.data.code, validOn: parsed.data.validOn };
}
