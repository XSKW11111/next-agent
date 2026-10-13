"use client";

import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import { MessageProcessor, type SurfaceModel, basicCatalog, injectBasicCatalogStyles } from "@a2ui/web_core/v0_9";
import { useState } from "react";
import type { CustomerToolCard } from "../service/tool/customer-tool-cards";
import { toolCardMessages } from "./tool-card-messages";

type Surface = NonNullable<ReturnType<MessageProcessor["model"]["surfacesMap"]["get"]>>;

export function ToolCards({ cards }: { cards: readonly CustomerToolCard[] }) {
  const [surfaces] = useState(() => openCards(cards));

  return (
    <div>
      {surfaces.map((surface) => (
        <A2uiSurface key={surface.id} surface={surface as SurfaceModel<ReactCatalogComponent>} />
      ))}
    </div>
  );
}

function openCards(cards: readonly CustomerToolCard[]): Surface[] {
  if (typeof document !== "undefined") injectBasicCatalogStyles();
  const processor = new MessageProcessor([basicCatalog], () => undefined);
  processor.processMessages(toolCardMessages(cards));
  return [...processor.model.surfacesMap.values()];
}
