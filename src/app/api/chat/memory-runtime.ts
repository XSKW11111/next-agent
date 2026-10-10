import { parseSession, type Session, type SessionId, type UnmatchedOrderStreak } from "../../../domain/session";
import type { Proposal, SupportCase } from "../../../domain/handoff";
import type { ScriptedModel, ScriptedReply, SupportMessage } from "../../../service/agent/support-turn";
import type { ProposalStore } from "../../../service/handoff/handoff";
import type { OrderCatalog, OrderStreakStore } from "../../../service/order/lookup-order";
import type { Catalog, Embedder } from "../../../service/product/search-products";
import type { EarlyRisersCodeStore } from "../../../service/promotion/claim-early-risers";
import type { MessageStore, SequenceUpdate, TurnMessage } from "../../../service/turn/message-store";
import type { ChatMessageLog, ChatRuntime, SessionStore } from "./runtime";

export const memoryReply = "Tell me the email on the order, or the product you want.";

const placeholderSessionId = "00000000-0000-4000-8000-000000000001";

export function memoryChatRuntime(): ChatRuntime {
  const sessions = memorySessions();
  const messages = memoryMessages();
  const proposals = memoryProposals();
  const streaks = memoryStreaks();
  return {
    sessions,
    messages,
    proposals,
    model: memoryModel(),
    dependencies: {
      orders: {
        catalog: emptyOrderCatalog(),
        streaks,
      },
      products: {
        catalog: emptyProductCatalog(),
        embedder: emptyEmbedder(),
      },
      promotion: {
        session: placeholderSession(),
        now: new Date(),
        store: emptyCodeStore(),
      },
      handoff: {
        store: proposals,
        turnId: "00000000-0000-4000-8000-000000000002",
        proposalId: "00000000-0000-4000-8000-000000000003",
      },
    },
    newSessionId() {
      return crypto.randomUUID();
    },
  };
}

const personWord = /\bperson\b/i;
const emailAddress =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i;

function memoryModel(): ScriptedModel {
  return {
    async complete(input) {
      return memoryCompletion(input.messages);
    },
  };
}

function memoryCompletion(messages: readonly SupportMessage[]): ScriptedReply {
  const cue = memoryCue(messages);
  switch (cue.kind) {
    case "after-handoff":
      return { text: "A person can take this from here." };
    case "propose":
      return {
        text: "",
        toolCalls: [
          {
            id: "memory-handoff",
            name: "capture_handoff",
            args: {
              contact_email: cue.email,
              reason: "The customer asked for a person",
            },
          },
        ],
      };
    case "reply":
      return { text: memoryReply };
    default: {
      const unexpected: never = cue;
      return unexpected;
    }
  }
}

type MemoryCue =
  | { readonly kind: "after-handoff" }
  | { readonly kind: "propose"; readonly email: string }
  | { readonly kind: "reply" };

function memoryCue(messages: readonly SupportMessage[]): MemoryCue {
  if (sawHandoffResult(messages)) return { kind: "after-handoff" };
  const text = latestUserText(messages);
  const email = text === undefined ? undefined : contactEmail(text);
  if (text !== undefined && personWord.test(text) && email !== undefined) {
    return { kind: "propose", email };
  }
  return { kind: "reply" };
}

function sawHandoffResult(messages: readonly SupportMessage[]): boolean {
  for (const message of messages) {
    switch (message.role) {
      case "tool":
        if (message.name === "capture_handoff") return true;
        break;
      case "user":
      case "assistant":
        break;
      default: {
        const unexpected: never = message;
        return unexpected;
      }
    }
  }
  return false;
}

function latestUserText(messages: readonly SupportMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.content;
  }
  return undefined;
}

function contactEmail(text: string): string | undefined {
  return emailAddress.exec(text)?.[0].toLowerCase();
}

function memorySessions(): SessionStore {
  const sessions = new Map<string, Session>();
  return {
    save(session) {
      sessions.set(session.id, session);
    },
    find(id) {
      return sessions.get(id);
    },
  };
}

function memoryMessages(): ChatMessageLog {
  const stored: TurnMessage[] = [];
  const next = new Map<SessionId, number>();
  const log: MessageStore & Pick<ChatMessageLog, "messagesForSession"> = {
    async messagesForSession(sessionId) {
      return stored.filter((message) => message.sessionId === sessionId);
    },
    async messagesForTurn(sessionId, turnId) {
      return stored.filter((message) => message.sessionId === sessionId && message.turnId === turnId);
    },
    async readNextSequence(sessionId) {
      return next.get(sessionId) ?? 1;
    },
    async conditionalUpdate(sessionId, expected): Promise<SequenceUpdate> {
      const current = next.get(sessionId) ?? 1;
      if (current !== expected) return { kind: "unchanged" };
      next.set(sessionId, expected + 1);
      return { kind: "updated", sequence: expected };
    },
    async insert(message) {
      stored.push(message);
    },
  };
  return log;
}

function memoryStreaks(): OrderStreakStore {
  const streaks = new Map<string, UnmatchedOrderStreak>();
  return {
    async read(sessionId) {
      return { kind: "ready", streak: streaks.get(sessionId) ?? 0 };
    },
    async write(sessionId, streak) {
      streaks.set(sessionId, streak);
      return { kind: "ready" };
    },
  };
}

function emptyOrderCatalog(): OrderCatalog {
  return {
    async listOrdersForEmail() {
      return { kind: "ready", orders: [] };
    },
  };
}

function emptyProductCatalog(): Catalog {
  return {
    async matchProducts() {
      return [];
    },
    async listProducts() {
      return [];
    },
  };
}

function emptyEmbedder(): Embedder {
  return {
    async embed() {
      return [];
    },
  };
}

function emptyCodeStore(): EarlyRisersCodeStore {
  return {
    async insertOrReuse(_key, create) {
      return create();
    },
  };
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

function placeholderSession(): Session {
  const session = parseSession({
    id: placeholderSessionId,
    localTimezone: { kind: "unresolved" },
    unmatchedOrderStreak: 0,
  });
  if (!session.ok) throw new Error("memory session is invalid");
  return session.value;
}
