import { expect, test } from "vitest";
import { parseProposal } from "../domain/handoff";
import { historyMessages } from "./history-messages";

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

test("a second history build keeps the tool card on the assistant row", () => {
  const proposal = pendingProposal();
  const body = {
    messages: [
      { turnId, role: "customer" as const, content: "where is order W002", sequence: 1 },
      { turnId, role: "assistant" as const, content: "Order #W002 is shipped.", sequence: 2 },
    ],
    proposals: [proposal],
    toolCards: [{ turnId, cards: [card] }],
  };

  const first = historyMessages(body);
  const second = historyMessages(body);

  expect(second).toEqual(first);
  expect(second).toEqual([
    {
      id: `${turnId}:customer`,
      role: "user",
      parts: [{ type: "text", text: "where is order W002" }],
    },
    {
      id: `${turnId}:assistant`,
      role: "assistant",
      parts: [
        { type: "text", text: "Order #W002 is shipped." },
        { type: "data-proposal", data: proposal },
        { type: "data-tool-cards", data: [card] },
      ],
    },
  ]);
});

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
