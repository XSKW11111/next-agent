import { describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderEmailSchema } from "@/domain/order";
import { sessionIdSchema } from "@/domain/session";
import { openRouterEmbedder, supabaseEarlyRisers, supabaseOrderCatalog, supabaseProductCatalog } from "@/infra/supabase-catalog";

describe("supabaseOrderCatalog", () => {
  test("reads #W002 for the matching customer email", async () => {
    const catalog = supabaseOrderCatalog(orderClient());
    const listing = await catalog.listOrdersForEmail(orderEmailSchema.parse("jane.smith@example.com"));
    expect(listing).toEqual({
      kind: "ready",
      orders: [
        {
          orderNumber: "#W002",
          status: "in-transit",
          trackingNumber: "TRK987654321",
        },
      ],
    });
  });
});

describe("supabaseProductCatalog", () => {
  test("lists a product name and stock", async () => {
    const catalog = supabaseProductCatalog(productClient());
    await expect(catalog.listProducts({ filters: { name: "backpack" }, limit: 5 })).resolves.toEqual([
      { name: "Bhavish's Backcountry Blaze Backpack", stockLevel: 120 },
    ]);
  });
});

describe("supabaseEarlyRisers", () => {
  test("claims through the hosted promotion function", async () => {
    const calls: unknown[] = [];
    const store = supabaseEarlyRisers(promotionClient(calls));
    const sessionId = sessionIdSchema.parse("4f5d0b8a-6c2e-4a1b-9d3f-1a2b3c4d5e6f");
    const record = await store.insertOrReuse(
      { sessionId, validOn: "2026-10-11", email: "jane.smith@example.com", timezone: "Asia/Shanghai" },
      () => ({
        sessionId,
        code: "EARLY-ABCD1234",
        validOn: "2026-10-11",
        expiresAt: "2026-10-12T00:00:00+08:00",
        timezone: "Asia/Shanghai",
      }),
    );
    expect(record.code).toBe("EARLY-ABCD1234");
    expect(calls).toEqual([
      {
        p_email: "jane.smith@example.com",
        p_campaign: "Early Risers",
        p_code: "EARLY-ABCD1234",
        p_discount_percent: 10,
        p_issued_at: expect.any(String),
        p_expires_at: "2026-10-12T00:00:00+08:00",
      },
    ]);
  });
});

describe("openRouterEmbedder", () => {
  test("asks OpenRouter for a 384 dimension embedding", async () => {
    let url = "";
    let body: unknown;
    const embedder = openRouterEmbedder("test-key", async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return Response.json({ data: [{ embedding: [0.25, 0.5] }] });
    });
    await expect(embedder.embed("backpack")).resolves.toEqual([0.25, 0.5]);
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(body).toMatchObject({
      model: "openai/text-embedding-3-small",
      input: "backpack",
      dimensions: 384,
    });
  });
});

function orderClient(): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            maybeSingle() {
              return Promise.resolve({
                data: {
                  orders: [
                    { order_number: "#W002", status: "in-transit", tracking_number: "TRK987654321" },
                  ],
                },
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function productClient(): SupabaseClient {
  return {
    rpc() {
      return Promise.resolve({
        data: [{ name: "Bhavish's Backcountry Blaze Backpack", inventory: 120 }],
        error: null,
      });
    },
  } as unknown as SupabaseClient;
}

function promotionClient(calls: unknown[]): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return this;
            },
            then(onFulfilled: (value: { data: unknown[]; error: null }) => unknown) {
              return Promise.resolve({ data: [], error: null }).then(onFulfilled);
            },
          };
        },
      };
    },
    rpc(_name: string, args: unknown) {
      calls.push(args);
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
}
