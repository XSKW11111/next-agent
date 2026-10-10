import { z } from "zod";
import { sessionIdSchema, type SessionId } from "../../../../../../domain/session";
import { parseTurn } from "../../../../../../domain/turn";
import { submitTurn, type SubmitTurnResult } from "../../../../../../service/turn/submit-turn";
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
  const session = await runtime.sessions.find(sessionId.value);
  if (session === undefined) return missing();

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

  const existing = runtime.proposals.findProposalForTurn(session.id, turn.value.id);
  const result = await submitTurn({
    sessionId: turn.value.sessionId,
    turnId: turn.value.id,
    text: turn.value.text,
    messages: runtime.messages,
    model: runtime.model,
    maxToolRounds: runtime.maxToolRounds ?? runtime.config.maxToolRounds,
    ...(runtime.productMatchThreshold === undefined
      ? {}
      : { productMatchThreshold: runtime.productMatchThreshold }),
    ...(runtime.maxProductCandidates === undefined
      ? {}
      : { maxProductCandidates: runtime.maxProductCandidates }),
    dependencies: {
      ...runtime.dependencies,
      promotion: {
        ...runtime.dependencies.promotion,
        session,
        now: new Date(),
      },
      handoff: {
        ...runtime.dependencies.handoff,
        turnId: turn.value.id,
        proposalId: existing?.id ?? crypto.randomUUID(),
      },
    },
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
  if ((await runtime.sessions.find(sessionId.value)) === undefined) return missing();

  const messages = await runtime.messages.messagesForSession(sessionId.value);
  return Response.json({
    messages: [...messages].sort((left, right) => left.sequence - right.sequence),
  });
}

function turnResponse(result: SubmitTurnResult): Response {
  switch (result.kind) {
    case "reply":
      return Response.json({ reply: result.reply });
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
