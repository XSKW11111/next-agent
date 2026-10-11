import { randomUUID } from "node:crypto";
import type { ChatRuntime } from "@/app/api/chat/runtime";
import { parseSession, type Session } from "@/domain/session";
import type { Proposal, SupportCase } from "@/domain/handoff";
import { parseAgentConfig } from "@/infra/agent-config";
import { openRouterModel } from "@/infra/openrouter-model";
import { createAgentSupabase } from "@/infra/supabase";
import { supabaseMessages, supabaseSessions, supabaseStreaks } from "@/infra/supabase-support";
import type { ProposalStore } from "@/service/business/handoff/handoff";
import type { OrderCatalog } from "@/service/business/order/lookup-order";
import type { Catalog, Embedder } from "@/service/business/product/search-products";
import type { EarlyRisersCodeStore } from "@/service/business/promotion/claim-early-risers";

const placeholderSessionId = "00000000-0000-4000-8000-000000000000";

export function liveChatRuntime(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: typeof fetch,
): ChatRuntime {
  const parsed = parseAgentConfig(env);
  if (!parsed.ok) {
    throw new Error(`agent config is invalid: ${parsed.names.join(", ")}`);
  }
  const client = createAgentSupabase(parsed.value);
  const proposals = memoryProposals();
  return {
    config: parsed.value,
    sessions: supabaseSessions(client),
    messages: supabaseMessages(client),
    proposals,
    model: openRouterModel(parsed.value, fetchImpl),
    dependencies: {
      orders: {
        catalog: unavailableOrders,
        streaks: supabaseStreaks(client),
      },
      products: {
        catalog: unavailableProducts,
        embedder: unavailableEmbedder,
      },
      promotion: {
        session: placeholderSession(),
        now: new Date(),
        store: unavailablePromotion,
      },
      handoff: {
        store: proposals,
        turnId: placeholderSessionId,
        proposalId: placeholderSessionId,
      },
    },
    newSessionId: randomUUID,
  };
}

const unavailableOrders: OrderCatalog = {
  async listOrdersForEmail() {
    return { kind: "unavailable" };
  },
};

const unavailableProducts: Catalog = {
  async matchProducts() {
    throw new Error("product catalog is not configured");
  },
  async listProducts() {
    throw new Error("product catalog is not configured");
  },
};

const unavailableEmbedder: Embedder = {
  async embed() {
    throw new Error("product catalog is not configured");
  },
};

const unavailablePromotion: EarlyRisersCodeStore = {
  async insertOrReuse() {
    throw new Error("early risers store is not configured");
  },
};

function placeholderSession(): Session {
  const session = parseSession({
    id: placeholderSessionId,
    localTimezone: { kind: "unresolved" },
    unmatchedOrderStreak: 0,
  });
  if (!session.ok) throw new Error("placeholder session is invalid");
  return session.value;
}

function memoryProposals(): ProposalStore {
  const proposals = new Map<string, Proposal>();
  const proposalIdByTurn = new Map<string, string>();
  const cases = new Map<string, SupportCase>();
  return {
    findProposalForTurn(sessionId, turnId) {
      const id = proposalIdByTurn.get(`${sessionId}\0${turnId}`);
      if (id === undefined) return undefined;
      return proposals.get(id);
    },
    findProposal(id) {
      return proposals.get(id);
    },
    saveProposal(proposal) {
      proposals.set(proposal.id, proposal);
      proposalIdByTurn.set(`${proposal.sessionId}\0${proposal.turnId}`, proposal.id);
    },
    findCase(id) {
      return cases.get(id);
    },
    saveCase(supportCase) {
      cases.set(supportCase.id, supportCase);
    },
  };
}
