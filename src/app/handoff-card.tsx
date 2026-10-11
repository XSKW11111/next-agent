"use client";

import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import { MessageProcessor, type SurfaceModel, basicCatalog, injectBasicCatalogStyles } from "@a2ui/web_core/v0_9";
import { useEffect, useState } from "react";
import { parseProposal, type Proposal } from "../domain/handoff";
import { handoffCardMessages } from "./handoff-card-messages";

type Surface = NonNullable<ReturnType<MessageProcessor["model"]["surfacesMap"]["get"]>>;

const cardActions = new Map<string, (name: string) => void>();

export function HandoffCard({ proposal, sessionId }: { proposal: Proposal; sessionId: string }) {
  const surfaceId = `handoff-${proposal.id}`;
  const [view, setView] = useState(() => openCard(proposal));

  cardActions.set(surfaceId, (name) => {
    if (name !== "confirm" && name !== "cancel") return;
    void decide(sessionId, view.proposal, name, view.processor, setView);
  });

  useEffect(() => {
    return () => {
      cardActions.delete(surfaceId);
    };
  }, [surfaceId]);

  return (
    <div>
      {view.surfaces.map((surface) => (
        <A2uiSurface key={surface.id} surface={surface as SurfaceModel<ReactCatalogComponent>} />
      ))}
    </div>
  );
}

function openCard(proposal: Proposal): { proposal: Proposal; processor: MessageProcessor; surfaces: Surface[] } {
  if (typeof document !== "undefined") injectBasicCatalogStyles();
  const surfaceId = `handoff-${proposal.id}`;
  const processor = new MessageProcessor([basicCatalog], (action) => {
    cardActions.get(surfaceId)?.(action.name);
  });
  processor.processMessages(handoffCardMessages(proposal));
  return { proposal, processor, surfaces: [...processor.model.surfacesMap.values()] };
}

async function decide(
  sessionId: string,
  proposal: Proposal,
  name: "confirm" | "cancel",
  processor: MessageProcessor,
  setView: (view: { proposal: Proposal; processor: MessageProcessor; surfaces: Surface[] }) => void,
): Promise<void> {
  const response = await fetch(`/api/chat/sessions/${sessionId}/handoffs/${proposal.id}/${name}`, {
    method: "POST",
  });
  if (!response.ok) return;
  const body = (await response.json()) as { decision?: unknown };
  if (body.decision !== "confirmed" && body.decision !== "cancelled") return;
  const next = parseProposal({
    decision: body.decision,
    id: proposal.id,
    sessionId: proposal.sessionId,
    turnId: proposal.turnId,
    contactEmail: proposal.contactEmail,
    reason: proposal.reason,
    ...(proposal.orderNumber === undefined ? {} : { orderNumber: proposal.orderNumber }),
    ...(body.decision === "confirmed" ? { caseId: proposal.id } : {}),
  });
  if (!next.ok) return;
  const messages = handoffCardMessages(next.value);
  const update = messages[1];
  if (update !== undefined) processor.processMessages([update]);
  setView({ proposal: next.value, processor, surfaces: [...processor.model.surfacesMap.values()] });
}
