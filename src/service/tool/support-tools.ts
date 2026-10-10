import { z } from "zod";
import type { Session, SessionId } from "../../domain/session";
import { captureHandoff, type ProposalStore } from "../business/handoff/handoff";
import { lookupOrder, type OrderCatalog, type OrderStreakStore } from "../business/order/lookup-order";
import {
  searchProducts,
  type ProductSearchDependencies,
} from "../business/product/search-products";
import {
  claimEarlyRisers,
  type EarlyRisersCodeStore,
} from "../business/promotion/claim-early-risers";
import type { ToolName } from "./run-tool-round";

const lookupArgsSchema = z.strictObject({
  email: z.string(),
  order_number: z.string().optional(),
});

const claimArgsSchema = z.strictObject({
  request: z.string().trim().min(1),
});

const handoffArgsSchema = z.strictObject({
  contact_email: z.string(),
  reason: z.string(),
  order_number: z.string().optional(),
});

export type SupportToolDependencies = {
  readonly orders: {
    readonly catalog: OrderCatalog;
    readonly streaks: OrderStreakStore;
  };
  readonly products: ProductSearchDependencies;
  readonly promotion: {
    readonly session: Session;
    readonly now: Date;
    readonly store: EarlyRisersCodeStore;
    readonly issueCode?: () => string;
  };
  readonly handoff: {
    readonly store: ProposalStore;
    readonly turnId: string;
    readonly proposalId: string;
  };
};

export type SupportToolCall = {
  readonly name: ToolName;
  readonly args: unknown;
  readonly sessionId: SessionId;
  readonly signal: AbortSignal | undefined;
  readonly dependencies: SupportToolDependencies;
  readonly productMatchThreshold?: number;
  readonly maxProductCandidates?: number;
};

export async function runSupportTool(call: SupportToolCall): Promise<unknown> {
  if (call.signal?.aborted) {
    throw call.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }
  try {
    return await runNamedTool(call);
  } catch (error) {
    if (call.signal?.aborted) throw error;
    return unavailable(call.name);
  }
}

async function runNamedTool(call: SupportToolCall): Promise<unknown> {
  switch (call.name) {
    case "lookup_order":
      return runLookup(call);
    case "search_products":
      return searchProducts(call.args, call.dependencies.products, {
        ...(call.productMatchThreshold === undefined
          ? {}
          : { threshold: call.productMatchThreshold }),
        ...(call.maxProductCandidates === undefined
          ? {}
          : { candidateLimit: call.maxProductCandidates }),
      });
    case "claim_early_risers":
      return runClaim(call);
    case "capture_handoff":
      return runCapture(call);
    default: {
      const unexpected: never = call.name;
      return unexpected;
    }
  }
}

async function runLookup(call: SupportToolCall): Promise<unknown> {
  const parsed = lookupArgsSchema.safeParse(call.args);
  if (!parsed.success) return unavailable("lookup_order");
  return lookupOrder(call.dependencies.orders.catalog, call.dependencies.orders.streaks, {
    sessionId: call.sessionId,
    email: parsed.data.email,
    ...(parsed.data.order_number === undefined ? {} : { orderNumber: parsed.data.order_number }),
  });
}

async function runClaim(call: SupportToolCall): Promise<unknown> {
  const parsed = claimArgsSchema.safeParse(call.args);
  if (!parsed.success) return unavailable("claim_early_risers");
  const promotion = call.dependencies.promotion;
  return claimEarlyRisers({
    session: promotion.session,
    now: promotion.now,
    store: promotion.store,
    ...(promotion.issueCode === undefined ? {} : { issueCode: promotion.issueCode }),
  });
}

function runCapture(call: SupportToolCall): unknown {
  const parsed = handoffArgsSchema.safeParse(call.args);
  if (!parsed.success) return unavailable("capture_handoff");
  const captured = captureHandoff(call.dependencies.handoff.store, {
    proposalId: call.dependencies.handoff.proposalId,
    sessionId: call.sessionId,
    turnId: call.dependencies.handoff.turnId,
    contactEmail: parsed.data.contact_email,
    reason: parsed.data.reason,
    ...(parsed.data.order_number === undefined ? {} : { orderNumber: parsed.data.order_number }),
  });
  if (!captured.ok) return unavailable("capture_handoff");
  return captured.value;
}

function unavailable(tool: ToolName): { readonly kind: "service_unavailable"; readonly tool: ToolName } {
  return { kind: "service_unavailable", tool };
}
