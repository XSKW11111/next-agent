import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog";
import type { Proposal } from "../domain/handoff";

type CardComponent = {
  id: string;
  component: string;
  text?: string;
  child?: string;
  children?: readonly string[];
  action?: { event: { name: string; context: Record<string, never> } };
};

export type HandoffCardMessage =
  | {
      version: "v0.9";
      createSurface: { surfaceId: string; catalogId: string };
    }
  | {
      version: "v0.9";
      updateComponents: { surfaceId: string; components: CardComponent[] };
    };

export function handoffCardMessages(proposal: Proposal): HandoffCardMessage[] {
  const surfaceId = `handoff-${proposal.id}`;
  const children = ["email", "reason"];
  const components: CardComponent[] = [
    { id: "email", component: "Text", text: proposal.contactEmail },
    { id: "reason", component: "Text", text: proposal.reason },
  ];
  if (proposal.orderNumber !== undefined) {
    children.push("order");
    components.push({ id: "order", component: "Text", text: proposal.orderNumber });
  }
  if (proposal.decision === "pending") {
    children.push("actions");
    components.push(
      { id: "actions", component: "Row", children: ["confirm", "cancel"] },
      {
        id: "confirm",
        component: "Button",
        child: "confirm-label",
        action: { event: { name: "confirm", context: {} } },
      },
      { id: "confirm-label", component: "Text", text: "Confirm" },
      {
        id: "cancel",
        component: "Button",
        child: "cancel-label",
        action: { event: { name: "cancel", context: {} } },
      },
      { id: "cancel-label", component: "Text", text: "Cancel" },
    );
  } else {
    children.push("decision");
    components.push({ id: "decision", component: "Text", text: proposal.decision });
  }
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: basicCatalog.id },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [{ id: "root", component: "Card", child: "body" }, { id: "body", component: "Column", children }, ...components],
      },
    },
  ];
}
