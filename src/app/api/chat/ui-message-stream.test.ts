import { expect, test } from "vitest";
import { parseProposal } from "../../../domain/handoff";
import { uiMessageStreamResponse } from "./ui-message-stream";

const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const proposalId = "33333333-3333-4333-8333-333333333333";

const card = {
  kind: "orders" as const,
  orders: [
    {
      orderNumber: "#W002",
      status: "shipped",
      trackingUrl: "https://track.example/1Z",
    },
  ],
};

test("the stream writes data-tool-cards after the text and the proposal", async () => {
  const proposal = pendingProposal();
  const response = uiMessageStreamResponse("On the way.", proposal, [card]);

  const events = await streamEvents(response);

  expect(events.filter(isVisible)).toEqual([
    { type: "text-delta", delta: "On the way." },
    { type: "data-proposal", data: proposal },
    { type: "data-tool-cards", data: [card] },
  ]);
});

test("the stream omits data-tool-cards when the list is empty", async () => {
  const proposal = pendingProposal();
  const response = uiMessageStreamResponse("On the way.", proposal, []);

  const events = await streamEvents(response);

  expect(events.filter(isVisible)).toEqual([
    { type: "text-delta", delta: "On the way." },
    { type: "data-proposal", data: proposal },
  ]);
});

function isVisible(event: { type: string }): boolean {
  return event.type === "text-delta" || event.type === "data-proposal" || event.type === "data-tool-cards";
}

function pendingProposal() {
  const parsed = parseProposal({
    decision: "pending",
    id: proposalId,
    sessionId,
    turnId,
    contactEmail: "person@example.com",
    reason: "I need a person",
    orderNumber: "#AB12",
  });
  if (!parsed.ok) throw new Error("fixture did not parse");
  return parsed.value;
}

async function streamEvents(response: Response): Promise<Array<{ type: string; delta?: string; data?: unknown }>> {
  const body = await response.text();
  const events: Array<{ type: string; delta?: string; data?: unknown }> = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length);
    if (payload === "[DONE]") continue;
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) continue;
    if (typeof parsed.type !== "string") continue;
    events.push({
      type: parsed.type,
      ...("delta" in parsed && typeof parsed.delta === "string" ? { delta: parsed.delta } : {}),
      ...("data" in parsed ? { data: parsed.data } : {}),
    });
  }
  return events;
}
