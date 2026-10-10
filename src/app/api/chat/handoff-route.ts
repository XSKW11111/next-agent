import { z } from "zod";
import { sessionIdSchema } from "../../../domain/session";
import {
  cancelHandoff,
  confirmHandoff,
  type HandoffDecision,
} from "../../../service/handoff/handoff";
import type { ChatRuntime } from "./runtime";

type HandoffContext = {
  params: Promise<{ id: string; proposalId: string }>;
};

type HandoffCommand = "confirm" | "cancel";

export async function postHandoff(
  context: HandoffContext,
  runtime: ChatRuntime,
  command: HandoffCommand,
): Promise<Response> {
  const params = await context.params;
  const sessionId = sessionIdSchema.safeParse(params.id);
  const proposalId = z.uuid().safeParse(params.proposalId);
  if (!sessionId.success || !proposalId.success) {
    return Response.json({ code: "invalid" }, { status: 400 });
  }
  if ((await runtime.sessions.find(sessionId.data)) === undefined) {
    return Response.json({ code: "missing" }, { status: 404 });
  }

  const proposal = runtime.proposals.findProposal(proposalId.data);
  if (proposal !== undefined && proposal.sessionId !== sessionId.data) {
    return Response.json({ code: "missing" }, { status: 404 });
  }

  switch (command) {
    case "confirm":
      return handoffResponse(confirmHandoff(runtime.proposals, { proposalId: proposalId.data }));
    case "cancel":
      return handoffResponse(cancelHandoff(runtime.proposals, { proposalId: proposalId.data }));
    default: {
      const unexpected: never = command;
      return unexpected;
    }
  }
}

function handoffResponse(result: HandoffDecision): Response {
  switch (result.decision) {
    case "missing":
      return Response.json({ code: "missing" }, { status: 404 });
    case "cancelled":
      return Response.json({ decision: "cancelled" });
    case "confirmed":
      return Response.json({ decision: "confirmed", supportCase: result.supportCase });
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}
