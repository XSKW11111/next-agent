import type { UIMessage } from "ai";
import type { Proposal } from "../domain/handoff";
import type { CustomerToolCard } from "../service/tool/customer-tool-cards";

export type ChatMessage = UIMessage<
  unknown,
  {
    proposal: Proposal;
    "tool-cards": CustomerToolCard[];
  }
>;

export type HistoryBody = {
  messages: StoredMessage[];
  proposals: Proposal[];
  toolCards?: readonly { turnId: string; cards: readonly CustomerToolCard[] }[];
};

type StoredMessage = {
  turnId: string;
  role: "customer" | "assistant";
  content: string;
  sequence: number;
};

export function historyMessages(body: HistoryBody): ChatMessage[] {
  const proposalsByTurn = new Map(body.proposals.map((proposal) => [String(proposal.turnId), proposal]));
  const cardsByTurn = new Map((body.toolCards ?? []).map((entry) => [entry.turnId, entry.cards]));
  return [...body.messages]
    .sort((left, right) => left.sequence - right.sequence)
    .map((message) => {
      const proposal = message.role === "assistant" ? proposalsByTurn.get(message.turnId) : undefined;
      const cards = message.role === "assistant" ? cardsByTurn.get(message.turnId) : undefined;
      const parts: ChatMessage["parts"] = [{ type: "text", text: message.content }];
      if (proposal !== undefined) {
        parts.push({ type: "data-proposal", data: proposal });
      }
      if (cards !== undefined && cards.length > 0) {
        parts.push({ type: "data-tool-cards", data: [...cards] });
      }
      return {
        id: `${message.turnId}:${message.role}`,
        role: message.role === "customer" ? "user" : "assistant",
        parts,
      };
    });
}
