import { expect, test } from "vitest";
import { parseProposal, type Proposal } from "../domain/handoff";
import { handoffCardMessages } from "./handoff-card-messages";

const proposalId = "33333333-3333-4333-8333-333333333333";
const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";

test("a pending proposal renders a card with Confirm and Cancel", () => {
  const components = componentsOf(handoffCardMessages(proposal("pending")));

  expect(components).toContainEqual({ id: "root", component: "Card", child: "body" });
  expect(components).toContainEqual({ id: "email", component: "Text", text: "person@example.com" });
  expect(components).toContainEqual({ id: "reason", component: "Text", text: "I need a person" });
  expect(components).toContainEqual({ id: "order", component: "Text", text: "#AB12" });
  expect(components).toContainEqual({ id: "confirm-label", component: "Text", text: "Confirm" });
  expect(components).toContainEqual({ id: "cancel-label", component: "Text", text: "Cancel" });
});

test("a confirmed proposal names the decision and has no buttons", () => {
  const components = componentsOf(handoffCardMessages(proposal("confirmed")));

  expect(components).toContainEqual({ id: "decision", component: "Text", text: "confirmed" });
  expect(components.some((component) => component.component === "Button")).toBe(false);
});

test("a cancelled proposal names the decision and has no buttons", () => {
  const components = componentsOf(handoffCardMessages(proposal("cancelled")));

  expect(components).toContainEqual({ id: "decision", component: "Text", text: "cancelled" });
  expect(components.some((component) => component.component === "Button")).toBe(false);
});

function componentsOf(messages: ReturnType<typeof handoffCardMessages>) {
  const update = messages[1];
  if (update === undefined || !("updateComponents" in update)) {
    throw new Error("handoff card did not include components");
  }
  return update.updateComponents.components;
}

function proposal(decision: Proposal["decision"]): Proposal {
  const parsed = parseProposal({
    decision,
    id: proposalId,
    sessionId,
    turnId,
    contactEmail: "person@example.com",
    reason: "I need a person",
    orderNumber: "#AB12",
    ...(decision === "confirmed" ? { caseId: proposalId } : {}),
  });
  if (!parsed.ok) throw new Error("fixture did not parse");
  return parsed.value;
}
