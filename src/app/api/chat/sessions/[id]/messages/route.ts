import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sessionIdSchema, type SessionId } from "../../../../../../domain/session";
import { parseTurn } from "../../../../../../domain/turn";
import { projectSupportTurnTraceView } from "../../../../../../service/trace/project-support-turn-trace-view";
import { submitTurn, type SubmitTurnResult } from "../../../../../../service/turn/submit-turn";
import { submitTracedTurn } from "../../../../../../service/turn/submit-traced-turn";
import type { CustomerToolCard } from "../../../../../../service/tool/customer-tool-cards";
import { currentChatRuntime, type ChatRuntime } from "../../../runtime";
import { uiMessageStreamResponse } from "../../../ui-message-stream";

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
  const turnInput = {
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
    toolCards: runtime.toolCards,
  };

  const started = performance.now();
  const tracing = runtime.turnTracing;
  if (tracing !== undefined) {
    const traced = await submitTracedTurn({ ...turnInput, tracing });
    const serverLatencyMs = Math.round(performance.now() - started);
    try {
      await saveTracedObservability(runtime, traced, turn.value.sessionId, turn.value.id, turn.value.text, serverLatencyMs);
    } catch {
      console.error("chat_observability_receipt_failed", {
        sessionId: turn.value.sessionId,
        turnId: turn.value.id,
        mode: "traced",
      });
    }
    return turnResponse(
      traced,
      runtime.proposals.findProposalForTurn(session.id, turn.value.id),
      runtime.toolCards.findForTurn(session.id, turn.value.id),
    );
  }

  const result = await submitTurn(turnInput);
  const serverLatencyMs = Math.round(performance.now() - started);
  try {
    await saveLatencyOnly(runtime, result, turn.value.sessionId, turn.value.id, turn.value.text, serverLatencyMs);
  } catch {
    console.error("chat_observability_receipt_failed", {
      sessionId: turn.value.sessionId,
      turnId: turn.value.id,
      mode: "latency_only",
    });
  }
  return turnResponse(
    result,
    runtime.proposals.findProposalForTurn(session.id, turn.value.id),
    runtime.toolCards.findForTurn(session.id, turn.value.id),
  );
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
    messages: [...messages]
      .filter((message) => message.role !== "summary")
      .sort((left, right) => left.sequence - right.sequence),
    proposals: runtime.proposals.listProposals(sessionId.value),
    toolCards: runtime.toolCards.listForSession(sessionId.value),
  });
}

async function saveTracedObservability(
  runtime: ChatRuntime,
  traced: Awaited<ReturnType<typeof submitTracedTurn>>,
  sessionId: string,
  turnId: string,
  currentSentence: string,
  serverLatencyMs: number,
): Promise<void> {
  const tracing = runtime.turnTracing;
  if (
    tracing === undefined ||
    traced.kind !== "reply" ||
    traced.langsmithRunId === null ||
    !("completion" in traced)
  ) {
    return;
  }
  const view = await projectSupportTurnTraceView({
    client: tracing.client,
    runId: traced.langsmithRunId,
    completion: traced.completion,
    traceInput: traced.traceInput,
  });
  const sink = tracing.config.sink === "langsmith" ? "langsmith+local" : "local";
  await runtime.observability.save({
    id: traced.langsmithRunId,
    sessionId,
    turnId,
    savedAt: new Date().toISOString(),
    currentSentence,
    reply: traced.reply,
    serverLatencyMs,
    stepTimingsMs: view.stepTimingsMs,
    trace: view,
    sink,
  });
}

async function saveLatencyOnly(
  runtime: ChatRuntime,
  result: SubmitTurnResult,
  sessionId: string,
  turnId: string,
  currentSentence: string,
  serverLatencyMs: number,
): Promise<void> {
  if (result.kind !== "reply") return;
  await runtime.observability.save({
    id: randomUUID(),
    sessionId,
    turnId,
    savedAt: new Date().toISOString(),
    currentSentence,
    reply: result.reply,
    serverLatencyMs,
    stepTimingsMs: {},
    trace: null,
    sink: "local",
  });
}

function turnResponse(
  result: SubmitTurnResult | Awaited<ReturnType<typeof submitTracedTurn>>,
  proposal: ReturnType<ChatRuntime["proposals"]["findProposalForTurn"]>,
  toolCards: readonly CustomerToolCard[] | undefined,
): Response {
  switch (result.kind) {
    case "reply":
      return uiMessageStreamResponse(result.reply, proposal, toolCards);
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
