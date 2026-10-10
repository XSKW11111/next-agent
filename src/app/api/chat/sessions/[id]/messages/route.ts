import { z } from "zod";
import { sessionIdSchema, type SessionId } from "../../../../../../domain/session";
import { parseTurn, type TurnId } from "../../../../../../domain/turn";
import type { SupportTurnDependencies } from "../../../../../../service/agent/support-turn";
import type { TurnMessage } from "../../../../../../service/turn/message-store";
import { submitTurn, type SubmitTurnResult } from "../../../../../../service/turn/submit-turn";
import { replyStreamResponse } from "../../../reply-stream";
import { currentChatRuntime, type ChatRuntime } from "../../../runtime";

const sendTurnBodySchema = z.strictObject({
  turnId: z.uuid(),
  text: z.string(),
});

type SessionContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: SessionContext,
  runtime: ChatRuntime = currentChatRuntime(),
): Promise<Response> {
  const sessionId = await readSessionId(context);
  if (!sessionId.ok) return invalid();
  if (runtime.sessions.find(sessionId.value) === undefined) return missing();

  const body = await readBody(request);
  if (!body.ok) return invalid();
  const parsed = sendTurnBodySchema.safeParse(body.value);
  if (!parsed.success) return invalid();

  const turn = parseTurn({
    id: parsed.data.turnId,
    sessionId: sessionId.value,
    text: parsed.data.text,
  });
  if (!turn.ok) return invalid();

  const result = await submitTurn({
    sessionId: turn.value.sessionId,
    turnId: turn.value.id,
    text: turn.value.text,
    messages: runtime.messages,
    model: runtime.model,
    dependencies: dependenciesForTurn(runtime, turn.value.sessionId, turn.value.id),
  });
  return turnResponse(result);
}

export async function GET(
  _request: Request,
  context: SessionContext,
  runtime: ChatRuntime = currentChatRuntime(),
): Promise<Response> {
  const sessionId = await readSessionId(context);
  if (!sessionId.ok) return invalid();
  if (runtime.sessions.find(sessionId.value) === undefined) return missing();

  const messages = [...(await runtime.messages.messagesForSession(sessionId.value))].sort(
    (left, right) => left.sequence - right.sequence,
  );
  return Response.json({
    messages,
    proposals: proposalsForSession(runtime, sessionId.value, messages),
  });
}

function dependenciesForTurn(
  runtime: ChatRuntime,
  sessionId: SessionId,
  turnId: TurnId,
): SupportTurnDependencies {
  const existing = runtime.proposals.findProposalForTurn(sessionId, turnId);
  return {
    ...runtime.dependencies,
    handoff: {
      ...runtime.dependencies.handoff,
      turnId,
      proposalId: existing?.id ?? crypto.randomUUID(),
    },
  };
}

function proposalsForSession(
  runtime: ChatRuntime,
  sessionId: SessionId,
  messages: readonly TurnMessage[],
) {
  const proposals = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.turnId)) continue;
    seen.add(message.turnId);
    const proposal = runtime.proposals.findProposalForTurn(sessionId, message.turnId);
    if (proposal === undefined) continue;
    proposals.push({
      turnId: proposal.turnId,
      proposalId: proposal.id,
      decision: proposal.decision,
    });
  }
  return proposals;
}

function turnResponse(result: SubmitTurnResult): Response {
  switch (result.kind) {
    case "reply":
      return replyStreamResponse(result.reply, result.handoff);
    case "rejected":
      return Response.json({ code: "rejected" }, { status: 409 });
    case "already_submitted":
      return Response.json({ code: "already_submitted" }, { status: 409 });
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

async function readSessionId(
  context: SessionContext,
): Promise<{ ok: true; value: SessionId } | { ok: false }> {
  const params = await context.params;
  const sessionId = sessionIdSchema.safeParse(params.id);
  if (!sessionId.success) return { ok: false };
  return { ok: true, value: sessionId.data };
}

async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await request.text();
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function invalid(): Response {
  return Response.json({ code: "invalid" }, { status: 400 });
}

function missing(): Response {
  return Response.json({ code: "missing" }, { status: 404 });
}
