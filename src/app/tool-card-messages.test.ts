import { expect, test } from "vitest";
import type { CustomerToolCard } from "../service/tool/customer-tool-cards";
import { toolCardMessages } from "./tool-card-messages";

const cards: readonly CustomerToolCard[] = [
  {
    kind: "orders",
    orders: [
      { orderNumber: "#W002", status: "shipped", trackingUrl: "https://track.example/1Z" },
      { orderNumber: "#W003", status: "processing" },
    ],
  },
  { kind: "products", products: [{ name: "Camp Mug", stockLevel: 4 }] },
  { kind: "early_risers", code: "EARLY-AAAAAAAA", validOn: "2026-10-08" },
];

test("tool cards are one read-only surface with one text line per fact", () => {
  const messages = toolCardMessages(cards);
  const update = messages[1];
  if (update === undefined || !("updateComponents" in update)) {
    throw new Error("tool cards did not include components");
  }

  expect(messages[0]).toEqual({
    version: "v0.9",
    createSurface: {
      surfaceId: "tool-cards",
      catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    },
  });
  expect(update.updateComponents.components).toEqual([
    { id: "root", component: "Card", child: "body" },
    {
      id: "body",
      component: "Column",
      children: ["line-0", "line-1", "line-2", "line-3", "line-4"],
    },
    { id: "line-0", component: "Text", text: "Order #W002 is shipped" },
    { id: "line-1", component: "Text", text: "https://track.example/1Z" },
    { id: "line-2", component: "Text", text: "Order #W003 is processing" },
    { id: "line-3", component: "Text", text: "Camp Mug, 4 in stock" },
    { id: "line-4", component: "Text", text: "Early Risers code EARLY-AAAAAAAA, 10% off, valid 2026-10-08" },
  ]);
});
