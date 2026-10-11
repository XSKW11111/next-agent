import type { SupabaseClient } from "@supabase/supabase-js";
import { orderNumberSchema } from "@/domain/order";
import type { Product } from "@/domain/product";
import type { CatalogOrder, OrderCatalog } from "@/service/business/order/lookup-order";
import type {
  AppliedFilters,
  Catalog,
  CatalogCandidate,
  Embedder,
  Embedding,
} from "@/service/business/product/search-products";
import type {
  EarlyRisersCodeRecord,
  EarlyRisersCodeStore,
} from "@/service/business/promotion/claim-early-risers";

const earlyRisersCampaign = "Early Risers";
const issuedCode = /^EARLY-[A-Za-z0-9]{8}$/;

type OrderRow = {
  readonly order_number?: unknown;
  readonly status?: unknown;
  readonly tracking_number?: unknown;
};

type ProductRow = {
  readonly name?: unknown;
  readonly inventory?: unknown;
  readonly similarity?: unknown;
};

export function supabaseOrderCatalog(client: SupabaseClient): OrderCatalog {
  return {
    async listOrdersForEmail(email) {
      try {
        const { data, error } = await client
          .from("customers")
          .select("orders(order_number, status, tracking_number)")
          .eq("email", email)
          .maybeSingle();
        if (error || data === null) return { kind: "unavailable" };
        return { kind: "ready", orders: ordersFrom(data) };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}

export function supabaseProductCatalog(client: SupabaseClient): Catalog {
  return {
    async matchProducts(query) {
      const { data, error } = await client.rpc("match_products", {
        query_embedding: vectorLiteral(query.embedding),
        top_k: 20,
        filters: rpcFilters(query.filters),
      });
      if (error || !Array.isArray(data)) {
        throw new Error("product match failed");
      }
      return data.flatMap(candidateFrom);
    },
    async listProducts(query) {
      const { data, error } = await client.rpc("list_products", {
        top_k: query.limit,
        filters: rpcFilters(query.filters),
      });
      if (error || !Array.isArray(data)) {
        throw new Error("product list failed");
      }
      return data.flatMap(productFrom);
    },
  };
}

export function openRouterEmbedder(apiKey: string, fetchImpl: typeof fetch = fetch): Embedder {
  return {
    async embed(query) {
      const response = await fetchImpl("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/text-embedding-3-small",
          input: query,
          dimensions: 384,
        }),
      });
      if (!response.ok) {
        throw new Error(`embedding request failed (${response.status})`);
      }
      const payload: unknown = await response.json();
      const embedding = embeddingFrom(payload);
      if (embedding === undefined) {
        throw new Error("embedding response is invalid");
      }
      return embedding;
    },
  };
}

export function supabaseEarlyRisers(client: SupabaseClient): EarlyRisersCodeStore {
  return {
    async insertOrReuse(key, create) {
      if (key.email === undefined) {
        throw new Error("promotion email is missing");
      }
      const existing = await findIssuedCode(client, { ...key, email: key.email });
      if (existing !== undefined) return existing;
      const created = create();
      const { error } = await client.rpc("claim_promotion", {
        p_email: key.email,
        p_campaign: earlyRisersCampaign,
        p_code: created.code,
        p_discount_percent: 10,
        p_issued_at: new Date().toISOString(),
        p_expires_at: created.expiresAt,
      });
      if (error) throw new Error("promotion claim failed");
      return created;
    },
  };
}

function ordersFrom(data: unknown): CatalogOrder[] {
  if (typeof data !== "object" || data === null || !("orders" in data)) return [];
  const orders = data.orders;
  if (!Array.isArray(orders)) return [];
  return orders.flatMap(orderFrom);
}

function orderFrom(row: unknown): CatalogOrder[] {
  if (!isOrderRow(row) || typeof row.order_number !== "string" || typeof row.status !== "string") {
    return [];
  }
  const orderNumber = orderNumberSchema.safeParse(row.order_number);
  if (!orderNumber.success) return [];
  const trackingNumber = typeof row.tracking_number === "string" ? row.tracking_number : null;
  return [{ orderNumber: orderNumber.data, status: row.status, trackingNumber }];
}

function isOrderRow(row: unknown): row is OrderRow {
  return typeof row === "object" && row !== null;
}

function productFrom(row: unknown): Product[] {
  if (!isProductRow(row) || typeof row.name !== "string" || typeof row.inventory !== "number") {
    return [];
  }
  return [{ name: row.name, stockLevel: row.inventory }];
}

function candidateFrom(row: unknown): CatalogCandidate[] {
  const product = productFrom(row);
  if (!isProductRow(row) || product[0] === undefined) return [];
  const similarity = typeof row.similarity === "number" ? row.similarity : Number(row.similarity);
  if (!Number.isFinite(similarity)) return [];
  return [{ product: product[0], similarity }];
}

function isProductRow(row: unknown): row is ProductRow {
  return typeof row === "object" && row !== null;
}

function rpcFilters(filters: AppliedFilters): Record<string, string | number> {
  return {
    ...(filters.minInventory === undefined ? {} : { min_inventory: filters.minInventory }),
    ...(filters.maxInventory === undefined ? {} : { max_inventory: filters.maxInventory }),
    ...(filters.sku === undefined ? {} : { sku: filters.sku }),
    ...(filters.name === undefined ? {} : { name: filters.name }),
  };
}

function vectorLiteral(embedding: Embedding): string {
  return `[${embedding.join(",")}]`;
}

function embeddingFrom(payload: unknown): Embedding | undefined {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) return undefined;
  const data = payload.data;
  if (!Array.isArray(data) || typeof data[0] !== "object" || data[0] === null || !("embedding" in data[0])) {
    return undefined;
  }
  const embedding = data[0].embedding;
  if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number")) {
    return undefined;
  }
  return embedding;
}

async function findIssuedCode(
  client: SupabaseClient,
  key: { readonly sessionId: EarlyRisersCodeRecord["sessionId"]; readonly email: string; readonly validOn: string; readonly timezone?: string },
): Promise<EarlyRisersCodeRecord | undefined> {
  const { data, error } = await client
    .from("promotion_codes")
    .select("code, expires_at, issued_at")
    .eq("email", key.email)
    .eq("campaign", earlyRisersCampaign);
  if (error || !Array.isArray(data)) return undefined;
  const match = data.find((row) => issuedOn(row) === key.validOn && typeof row.code === "string" && issuedCode.test(row.code));
  if (match === undefined || typeof match.code !== "string" || typeof match.expires_at !== "string" || key.timezone === undefined) {
    return undefined;
  }
  return {
    sessionId: key.sessionId,
    code: match.code,
    validOn: key.validOn,
    expiresAt: match.expires_at,
    timezone: key.timezone,
  };
}

function issuedOn(row: { readonly issued_at?: unknown }): string | undefined {
  return typeof row.issued_at === "string" ? row.issued_at.slice(0, 10) : undefined;
}
