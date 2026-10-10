import { z } from "zod";
import type { Product } from "../../../domain/product";

const STRONG_SIMILARITY_MINIMUM = 0.3;
const SEMANTIC_RESULT_LIMIT = 5;
const LIST_PAGE_SIZE = 20;

const CATALOG_FIELDS = ["name", "stockLevel"] as const;
const MISSING_FIELDS = ["price", "size", "color", "rating", "stock-keeping code"] as const;

const filterSchema = z.strictObject({
  min_inventory: z.number().int().nonnegative().optional(),
  max_inventory: z.number().int().nonnegative().optional(),
  inventory_gt: z.number().int().nonnegative().optional(),
  sku: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
});

const requestSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("semantic"),
    query: z.string().trim().min(1),
    filters: z.unknown().optional(),
  }),
  z.strictObject({
    mode: z.literal("list"),
    filters: z.unknown().optional(),
  }),
]);

export type AppliedFilters = {
  readonly minInventory?: number;
  readonly maxInventory?: number;
  readonly sku?: string;
  readonly name?: string;
};

export type Embedding = readonly number[];

export type Embedder = {
  embed(query: string): Promise<Embedding>;
};

export type CatalogCandidate = {
  readonly product: Product;
  readonly similarity: number;
};

export type Catalog = {
  matchProducts(query: {
    readonly embedding: Embedding;
    readonly filters: AppliedFilters;
  }): Promise<readonly CatalogCandidate[]>;
  listProducts(query: {
    readonly filters: AppliedFilters;
    readonly limit: number;
  }): Promise<readonly Product[]>;
};

export type ProductSearchDependencies = {
  readonly catalog: Catalog;
  readonly embedder: Embedder;
};

export type ProductMatchLimits = {
  readonly threshold?: number;
  readonly candidateLimit?: number;
};

type FilterRejectReason =
  | "conflicting_inventory_bounds"
  | "reversed_bounds"
  | "unknown_filter"
  | "invalid_filter";

type CatalogFacts = {
  readonly kind: "products_found";
  readonly filtersApplied: AppliedFilters;
  readonly catalogFields: typeof CATALOG_FIELDS;
  readonly missingFields: typeof MISSING_FIELDS;
};

export type ProductSearchResult =
  | (CatalogFacts & {
      readonly mode: "semantic";
      readonly matchQuality: "strong";
      readonly absent: false;
      readonly products: readonly [Product, ...Product[]];
      readonly alternatives: readonly Product[];
    })
  | (CatalogFacts & {
      readonly mode: "semantic";
      readonly matchQuality: "relaxed";
      readonly absent: false;
      readonly relaxedConstraint: "similarity";
      readonly products: readonly [];
      readonly alternatives: readonly [Product, ...Product[]];
    })
  | (CatalogFacts & {
      readonly mode: "semantic";
      readonly matchQuality: "none";
      readonly absent: true;
      readonly products: readonly [];
      readonly alternatives: readonly [];
    })
  | (CatalogFacts & {
      readonly mode: "list";
      readonly absent: false;
      readonly products: readonly Product[];
    })
  | {
      readonly kind: "filters_rejected";
      readonly reason: FilterRejectReason;
    }
  | {
      readonly kind: "request_rejected";
      readonly reason: "invalid_request";
    };

type ResolvedFilters =
  | { readonly ok: true; readonly filters: AppliedFilters }
  | { readonly ok: false; readonly reason: FilterRejectReason };

export async function searchProducts(
  input: unknown,
  dependencies: ProductSearchDependencies,
  limits?: ProductMatchLimits,
): Promise<ProductSearchResult> {
  const request = requestSchema.safeParse(input);
  if (!request.success) {
    return { kind: "request_rejected", reason: "invalid_request" };
  }

  const resolved = resolveFilters(request.data.filters);
  if (!resolved.ok) {
    return { kind: "filters_rejected", reason: resolved.reason };
  }

  switch (request.data.mode) {
    case "semantic":
      return searchSemantic(
        request.data.query,
        resolved.filters,
        dependencies,
        resolvedLimits(limits),
      );
    case "list":
      return searchList(resolved.filters, dependencies);
    default: {
      const unreachable: never = request.data;
      return unreachable;
    }
  }
}

async function searchSemantic(
  query: string,
  filters: AppliedFilters,
  dependencies: ProductSearchDependencies,
  limits: { readonly threshold: number; readonly candidateLimit: number },
): Promise<ProductSearchResult> {
  const embedding = await dependencies.embedder.embed(query);
  const candidates = await dependencies.catalog.matchProducts({ embedding, filters });
  return semanticResult(candidates, filters, limits);
}

async function searchList(
  filters: AppliedFilters,
  dependencies: ProductSearchDependencies,
): Promise<ProductSearchResult> {
  const products = await dependencies.catalog.listProducts({
    filters,
    limit: LIST_PAGE_SIZE,
  });
  return {
    ...catalogFacts(filters),
    mode: "list",
    absent: false,
    products,
  };
}

function semanticResult(
  candidates: readonly CatalogCandidate[],
  filters: AppliedFilters,
  limits: { readonly threshold: number; readonly candidateLimit: number },
): ProductSearchResult {
  const ranked = [...candidates].sort((left, right) => right.similarity - left.similarity);
  const strong = ranked
    .filter((candidate) => candidate.similarity >= limits.threshold)
    .slice(0, limits.candidateLimit)
    .map((candidate) => candidate.product);
  const alternatives = ranked
    .filter((candidate) => candidate.similarity < limits.threshold)
    .map((candidate) => candidate.product);
  const products = nonEmpty(strong);
  if (products !== undefined) {
    return {
      ...catalogFacts(filters),
      mode: "semantic",
      matchQuality: "strong",
      absent: false,
      products,
      alternatives,
    };
  }

  const relaxed = nonEmpty(alternatives);
  if (relaxed !== undefined) {
    return {
      ...catalogFacts(filters),
      mode: "semantic",
      matchQuality: "relaxed",
      absent: false,
      relaxedConstraint: "similarity",
      products: [],
      alternatives: relaxed,
    };
  }

  return {
    ...catalogFacts(filters),
    mode: "semantic",
    matchQuality: "none",
    absent: true,
    products: [],
    alternatives: [],
  };
}

function resolveFilters(raw: unknown): ResolvedFilters {
  if (raw === undefined) return { ok: true, filters: {} };

  const parsed = filterSchema.safeParse(raw);
  if (!parsed.success) {
    const unknownKey = parsed.error.issues.some((issue) => issue.code === "unrecognized_keys");
    return { ok: false, reason: unknownKey ? "unknown_filter" : "invalid_filter" };
  }

  if (parsed.data.min_inventory !== undefined && parsed.data.inventory_gt !== undefined) {
    return { ok: false, reason: "conflicting_inventory_bounds" };
  }

  const minInventory =
    parsed.data.inventory_gt === undefined ? parsed.data.min_inventory : parsed.data.inventory_gt + 1;
  if (
    minInventory !== undefined &&
    parsed.data.max_inventory !== undefined &&
    minInventory > parsed.data.max_inventory
  ) {
    return { ok: false, reason: "reversed_bounds" };
  }

  return {
    ok: true,
    filters: appliedFilters(parsed.data, minInventory),
  };
}

function appliedFilters(
  parsed: z.infer<typeof filterSchema>,
  minInventory: number | undefined,
): AppliedFilters {
  return {
    ...(minInventory === undefined ? {} : { minInventory }),
    ...(parsed.max_inventory === undefined ? {} : { maxInventory: parsed.max_inventory }),
    ...(parsed.sku === undefined ? {} : { sku: parsed.sku }),
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
  };
}

function resolvedLimits(limits: ProductMatchLimits | undefined): {
  readonly threshold: number;
  readonly candidateLimit: number;
} {
  return {
    threshold: limits?.threshold ?? STRONG_SIMILARITY_MINIMUM,
    candidateLimit: limits?.candidateLimit ?? SEMANTIC_RESULT_LIMIT,
  };
}

function catalogFacts(filtersApplied: AppliedFilters): CatalogFacts {
  return {
    kind: "products_found",
    filtersApplied,
    catalogFields: CATALOG_FIELDS,
    missingFields: MISSING_FIELDS,
  };
}

function nonEmpty(products: readonly Product[]): readonly [Product, ...Product[]] | undefined {
  const [head, ...tail] = products;
  if (head === undefined) return undefined;
  return [head, ...tail];
}
