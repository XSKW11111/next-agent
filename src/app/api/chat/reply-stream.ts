import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import type { HandoffPart } from "../../../domain/handoff";

const replyTextChunkLength = 16;
const replyTextPartId = "reply";

export function replyStreamResponse(reply: string, handoff?: HandoffPart): Response {
  const stream = createUIMessageStream({
    execute({ writer }) {
      for (const chunk of replyChunks(reply, handoff)) writer.write(chunk);
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function replyChunks(reply: string, handoff: HandoffPart | undefined): readonly UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: replyTextPartId },
  ];
  for (const delta of replyTextDeltas(reply)) {
    chunks.push({ type: "text-delta", id: replyTextPartId, delta });
  }
  chunks.push({ type: "text-end", id: replyTextPartId });
  if (handoff !== undefined) {
    chunks.push({ type: "data-handoff", id: handoff.proposalId, data: handoff });
  }
  chunks.push({ type: "finish-step" }, { type: "finish" });
  return chunks;
}

function replyTextDeltas(reply: string): readonly string[] {
  if (reply.length <= replyTextChunkLength) return [reply];
  const deltas: string[] = [];
  for (let start = 0; start < reply.length; start += replyTextChunkLength) {
    deltas.push(reply.slice(start, start + replyTextChunkLength));
  }
  return deltas;
}
