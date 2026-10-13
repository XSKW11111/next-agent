import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { Proposal } from "../../../domain/handoff";
import type { CustomerToolCard } from "../../../service/tool/customer-tool-cards";
import type { ChatMessage } from "../../history-messages";

export function uiMessageStreamResponse(
  reply: string,
  proposal: Proposal | undefined,
  toolCards: readonly CustomerToolCard[] | undefined,
): Response {
  const stream = createUIMessageStream<ChatMessage>({
    execute({ writer }) {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "reply" });
      writer.write({ type: "text-delta", id: "reply", delta: reply });
      writer.write({ type: "text-end", id: "reply" });
      if (proposal !== undefined) {
        writer.write({ type: "data-proposal", data: proposal });
      }
      if (toolCards !== undefined && toolCards.length > 0) {
        writer.write({ type: "data-tool-cards", data: [...toolCards] });
      }
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
