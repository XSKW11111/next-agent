import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog";
import type { CustomerToolCard } from "../service/tool/customer-tool-cards";

type CardComponent = {
  id: string;
  component: string;
  text?: string;
  child?: string;
  children?: readonly string[];
};

export type ToolCardMessage =
  | {
      version: "v0.9";
      createSurface: { surfaceId: string; catalogId: string };
    }
  | {
      version: "v0.9";
      updateComponents: { surfaceId: string; components: CardComponent[] };
    };

const surfaceId = "tool-cards";

export function toolCardMessages(cards: readonly CustomerToolCard[]): ToolCardMessage[] {
  const lines = factLines(cards);
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: basicCatalog.id },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Card", child: "body" },
          { id: "body", component: "Column", children: lines.map((line) => line.id) },
          ...lines.map((line) => ({ id: line.id, component: "Text", text: line.text })),
        ],
      },
    },
  ];
}

function factLines(cards: readonly CustomerToolCard[]): { id: string; text: string }[] {
  const lines: { id: string; text: string }[] = [];
  for (const card of cards) {
    for (const text of texts(card)) {
      lines.push({ id: `line-${lines.length}`, text });
    }
  }
  return lines;
}

function texts(card: CustomerToolCard): string[] {
  switch (card.kind) {
    case "orders":
      return card.orders.flatMap((order) =>
        order.trackingUrl === undefined
          ? [`Order ${order.orderNumber} is ${order.status}`]
          : [`Order ${order.orderNumber} is ${order.status}`, order.trackingUrl],
      );
    case "products":
      return card.products.map((product) => `${product.name}, ${product.stockLevel} in stock`);
    case "early_risers":
      return [`Early Risers code ${card.code}, 10% off, valid ${card.validOn}`];
    default: {
      const unexpected: never = card;
      return unexpected;
    }
  }
}
