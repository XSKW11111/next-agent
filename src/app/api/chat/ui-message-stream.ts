import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import type { Proposal } from "../../../domain/handoff";

type ChatMessage = UIMessage<unknown, { proposal: Proposal }>;

export function uiMessageStreamResponse(reply: string, proposal: Proposal | undefined): Response {
  const stream = createUIMessageStream<ChatMessage>({
    execute({ writer }) {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "reply" });
      writer.write({ type: "text-delta", id: "reply", delta: reply });
      writer.write({ type: "text-end", id: "reply" });
      if (proposal !== undefined) {
        writer.write({ type: "data-proposal", data: proposal });
      }
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
