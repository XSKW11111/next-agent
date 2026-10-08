import { expect, test } from "vitest";
import type { Catalog, Embedder } from "./search-products";
import { searchProducts } from "./search-products";

const missingFields = ["price", "size", "color", "rating", "stock-keeping code"] as const;
const catalogFields = ["name", "stockLevel"] as const;

function embedder(embed: Embedder["embed"]): Embedder {
  return { embed };
}

function catalog(overrides: Partial<Catalog>): Catalog {
  return {
    async matchProducts() {
      throw new Error("matchProducts called");
    },
    async listProducts() {
      throw new Error("listProducts called");
    },
    ...overrides,
  };
}

test("semantic search returns a strong match and a weaker alternative", async () => {
  const result = await searchProducts(
    { mode: "semantic", query: "  camp mug  " },
    {
      embedder: embedder(async (query) => (query === "camp mug" ? [0.2, 0.4] : [])),
      catalog: catalog({
        async matchProducts(query) {
          if (query.embedding.length === 0) return [];
          return [
            { product: { name: "Weak Lantern", stockLevel: 2 }, similarity: 0.29 },
            { product: { name: "Camp Mug", stockLevel: 4 }, similarity: 0.91 },
            { product: { name: "Spare Lid", stockLevel: 1 }, similarity: 0.3 },
          ];
        },
      }),
    },
  );

  expect(result).toEqual({
    kind: "products_found",
    mode: "semantic",
    matchQuality: "strong",
    absent: false,
    filtersApplied: {},
    catalogFields,
    missingFields,
    products: [
      { name: "Camp Mug", stockLevel: 4 },
      { name: "Spare Lid", stockLevel: 1 },
    ],
    alternatives: [{ name: "Weak Lantern", stockLevel: 2 }],
  });
});

test("semantic search returns a relaxed alternative below the strong floor", async () => {
  const result = await searchProducts(
    { mode: "semantic", query: "lantern" },
    {
      embedder: embedder(async () => [1]),
      catalog: catalog({
        async matchProducts() {
          return [{ product: { name: "Weak Lantern", stockLevel: 2 }, similarity: 0.29 }];
        },
      }),
    },
  );

  expect(result).toEqual({
    kind: "products_found",
    mode: "semantic",
    matchQuality: "relaxed",
    absent: false,
    relaxedConstraint: "similarity",
    filtersApplied: {},
    catalogFields,
    missingFields,
    products: [],
    alternatives: [{ name: "Weak Lantern", stockLevel: 2 }],
  });
});

test("semantic search says the product is absent when nothing matches", async () => {
  const result = await searchProducts(
    { mode: "semantic", query: "missing tent" },
    {
      embedder: embedder(async () => [1]),
      catalog: catalog({
        async matchProducts() {
          return [];
        },
      }),
    },
  );

  expect(result).toEqual({
    kind: "products_found",
    mode: "semantic",
    matchQuality: "none",
    absent: true,
    filtersApplied: {},
    catalogFields,
    missingFields,
    products: [],
    alternatives: [],
  });
});

test("semantic search keeps at most five strong matches", async () => {
  const strong = [
    { name: "One", stockLevel: 1 },
    { name: "Two", stockLevel: 2 },
    { name: "Three", stockLevel: 3 },
    { name: "Four", stockLevel: 4 },
    { name: "Five", stockLevel: 5 },
    { name: "Six", stockLevel: 6 },
  ];

  const result = await searchProducts(
    { mode: "semantic", query: "trail gear" },
    {
      embedder: embedder(async () => [1]),
      catalog: catalog({
        async matchProducts() {
          return strong
            .map((product, index) => ({
              product,
              similarity: 0.95 - index * 0.05,
            }))
            .reverse();
        },
      }),
    },
  );

  expect(result).toEqual({
    kind: "products_found",
    mode: "semantic",
    matchQuality: "strong",
    absent: false,
    filtersApplied: {},
    catalogFields,
    missingFields,
    products: strong.slice(0, 5),
    alternatives: [],
  });
});

test("list mode returns a page of 20 and does not embed", async () => {
  const page = Array.from({ length: 20 }, (_, index) => ({
    name: `Trail Item ${index + 1}`,
    stockLevel: index,
  }));

  const result = await searchProducts(
    { mode: "list" },
    {
      embedder: embedder(async () => {
        throw new Error("list mode must not embed");
      }),
      catalog: catalog({
        async listProducts(query) {
          if (query.limit !== 20) return [];
          return page;
        },
      }),
    },
  );

  expect(result).toEqual({
    kind: "products_found",
    mode: "list",
    absent: false,
    filtersApplied: {},
    catalogFields,
    missingFields,
    products: page,
  });
});

test("inventory_gt is stored as the next stock level", async () => {
  const result = await searchProducts(
    { mode: "list", filters: { inventory_gt: 2, sku: "MUG" } },
    {
      embedder: embedder(async () => {
        throw new Error("list mode must not embed");
      }),
      catalog: catalog({
        async listProducts(query) {
          if (query.filters.minInventory !== 3 || query.filters.sku !== "MUG") return [];
          return [{ name: "Camp Mug", stockLevel: 4 }];
        },
      }),
    },
  );

  expect(result).toEqual({
    kind: "products_found",
    mode: "list",
    absent: false,
    filtersApplied: { minInventory: 3, sku: "MUG" },
    catalogFields,
    missingFields,
    products: [{ name: "Camp Mug", stockLevel: 4 }],
  });
});

test("min_inventory and inventory_gt together are rejected", async () => {
  const result = await searchProducts(
    { mode: "list", filters: { min_inventory: 1, inventory_gt: 4 } },
    {
      embedder: embedder(async () => {
        throw new Error("rejected filters must not embed");
      }),
      catalog: catalog({}),
    },
  );

  expect(result).toEqual({
    kind: "filters_rejected",
    reason: "conflicting_inventory_bounds",
  });
});

test("reversed inventory bounds are rejected", async () => {
  const result = await searchProducts(
    { mode: "semantic", query: "mug", filters: { inventory_gt: 5, max_inventory: 4 } },
    {
      embedder: embedder(async () => {
        throw new Error("rejected filters must not embed");
      }),
      catalog: catalog({}),
    },
  );

  expect(result).toEqual({
    kind: "filters_rejected",
    reason: "reversed_bounds",
  });
});

test("an unknown filter key is rejected", async () => {
  const result = await searchProducts(
    { mode: "list", filters: { name: "Camp Mug", price: 12 } },
    {
      embedder: embedder(async () => {
        throw new Error("rejected filters must not embed");
      }),
      catalog: catalog({}),
    },
  );

  expect(result).toEqual({
    kind: "filters_rejected",
    reason: "unknown_filter",
  });
});
