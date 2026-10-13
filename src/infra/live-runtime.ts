import { randomUUID } from "node:crypto";
import type { ChatRuntime } from "@/app/api/chat/runtime";
import { parseSession, type Session } from "@/domain/session";
import type { Proposal, SupportCase } from "@/domain/handoff";
import { parseAgentConfig } from "@/infra/agent-config";
import { openRouterModel } from "@/infra/open-router-model";
import { createAgentSupabase } from "@/infra/supabase";
import { openRouterEmbedder, supabaseEarlyRisers, supabaseOrderCatalog, supabaseProductCatalog } from "@/infra/supabase-catalog";
import { supabaseMessages, supabaseSessions, supabaseStreaks } from "@/infra/supabase-support";
import type { ProposalStore } from "@/service/business/handoff/handoff";
import { memoryToolCardStore } from "@/service/tool/customer-tool-cards";

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
    toolCards: memoryToolCardStore(),
    model: openRouterModel(parsed.value, fetchImpl ?? fetch),
    dependencies: {
      orders: {
        catalog: supabaseOrderCatalog(client),
        streaks: supabaseStreaks(client),
      },
      products: {
        catalog: supabaseProductCatalog(client),
        embedder: openRouterEmbedder(parsed.value.openRouterApiKey, fetchImpl),
      },
      promotion: {
        session: placeholderSession(),
        now: new Date(),
        store: supabaseEarlyRisers(client),
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
    listProposals(sessionId) {
      return [...proposals.values()].filter((proposal) => proposal.sessionId === sessionId);
    },
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
