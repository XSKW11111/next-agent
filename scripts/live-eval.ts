/**
 * Live eval against the debug environment.
 *
 * Requires LANGSMITH_API_KEY, LANGSMITH_PROJECT,
 * and the usual agent config. Point LIVE_EVAL_BASE at a debug-configured Next
 * server when using HTTP mode (default). Trace ids stay empty over HTTP until
 * the messages route exposes them; prefer in-process mode for full C3 fields:
 *
 *   LIVE_EVAL_MODE=in-process npx tsx scripts/live-eval.ts
 */
import { randomBytes, randomUUID } from "node:crypto";
import { debugChatRuntime } from "../src/infra/debug-runtime.ts";
import { debugOrderCatalog } from "../src/infra/debug-catalog.ts";
import { projectSupportTurnTraceView } from "../src/service/trace/project-support-turn-trace-view.ts";
import {
  langsmithTraceUrl,
  runLiveCases,
  type LiveAskResult,
  type LiveTrialTrace,
} from "../src/service/eval/live-cases.ts";
import { submitTracedTurn } from "../src/service/turn/submit-traced-turn.ts";
import type { Session } from "../src/domain/session.ts";
import { parseSession } from "../src/domain/session.ts";

const baseUrl = process.env.LIVE_EVAL_BASE ?? "http://127.0.0.1:3000";
const mode = process.env.LIVE_EVAL_MODE ?? "http";

const report =
  mode === "in-process"
    ? await runLiveCases(inProcessAsk)
    : await runLiveCases(httpAsk);

console.log(JSON.stringify(report, null, 2));

async function httpAsk(context: {
  readonly turns: readonly string[];
}): Promise<LiveAskResult> {
  const created = await fetch(`${baseUrl}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timezone: "Asia/Shanghai" }),
  });
  const session = (await created.json()) as { id?: string };
  const ownerCookie = created.headers.get("set-cookie")?.split(";")[0];
  if (session.id === undefined || ownerCookie === undefined) throw new Error("session create failed");
  const replies: string[] = [];
  const traces: LiveTrialTrace[] = [];
  for (const text of context.turns) {
    const response = await fetch(`${baseUrl}/api/chat/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ turnId: crypto.randomUUID(), text }),
    });
    replies.push(textFrom(await response.text()));
    traces.push({
      traceId: "",
      traceUrl: "",
    });
  }
  return { replies, traces };
}

async function inProcessAsk(context: {
  readonly id: string;
  readonly turns: readonly string[];
  readonly variant?: string;
}): Promise<LiveAskResult> {
  const orderCase =
    context.id === "order-outage"
      ? "order-outage"
      : context.id === "email-orders"
        ? "email-orders"
        : undefined;
  const runtime = debugChatRuntime(process.env, {
    ...(orderCase === undefined ? {} : { orderCatalog: debugOrderCatalog(orderCase) }),
  });
  const session = sessionForVariant(context.variant, runtime.newSessionId());
  await runtime.sessions.save(session, randomBytes(32).toString("hex"));

  const replies: string[] = [];
  const traces: LiveTrialTrace[] = [];
  for (const text of context.turns) {
    const traced = await submitTracedTurn({
      sessionId: session.id,
      turnId: randomUUID(),
      text,
      messages: runtime.messages,
      model: runtime.model,
      dependencies: {
        ...runtime.dependencies,
        promotion: {
          ...runtime.dependencies.promotion,
          session,
          now: nowForVariant(context.variant),
        },
        handoff: {
          ...runtime.dependencies.handoff,
          turnId: randomUUID(),
          proposalId: randomUUID(),
        },
      },
      toolCards: runtime.toolCards,
      maxToolRounds: runtime.config.maxToolRounds,
      productMatchThreshold: runtime.config.productMatchThreshold,
      maxProductCandidates: runtime.config.maxProductCandidates,
      tracing: runtime.turnTracing,
    });
    if (traced.kind !== "reply" || traced.langsmithRunId === null || !("completion" in traced)) {
      throw new Error(`traced turn did not complete for ${context.id}`);
    }
    replies.push(traced.reply);
    const view = await projectSupportTurnTraceView({
      client: runtime.turnTracing.client,
      runId: traced.langsmithRunId,
      completion: traced.completion,
      traceInput: traced.traceInput,
    });
    const lookup = view.output.toolResults.find((result) => result.tool === "lookup_order");
    traces.push({
      traceId: traced.langsmithRunId,
      traceUrl: langsmithTraceUrl(runtime.turnTracing.config.project, traced.langsmithRunId),
      ...(lookup === undefined
        ? {}
        : {
            lookupResult: {
              kind:
                lookup.payload !== null &&
                typeof lookup.payload === "object" &&
                "kind" in lookup.payload &&
                typeof lookup.payload.kind === "string"
                  ? lookup.payload.kind
                  : "unknown",
            },
          }),
      ...(view.input.priorTurns[0] === undefined
        ? {}
        : {
            priorCustomerSentence: view.input.priorTurns[0].customer,
            priorAssistantSentence: view.input.priorTurns[0].assistant,
          }),
      ...(context.id === "email-orders"
        ? {
            orders: [
              { orderNumber: "#W002", status: "in-transit" },
              { orderNumber: "#W003", status: "processing" },
            ],
          }
        : {}),
    });
  }
  return { replies, traces };
}

function sessionForVariant(variant: string | undefined, id: string): Session {
  const timezone =
    variant === "unresolved" || variant === undefined
      ? ({ kind: "unresolved" } as const)
      : ({ kind: "resolved", name: "Asia/Shanghai" } as const);
  const parsed = parseSession({
    id,
    localTimezone: timezone,
    unmatchedOrderStreak: 0,
  });
  if (!parsed.ok) throw new Error("eval session is invalid");
  return parsed.value;
}

function nowForVariant(variant: string | undefined): Date {
  switch (variant) {
    case "outside":
      return new Date("2026-10-13T04:00:00.000Z");
    case "inside":
      return new Date("2026-10-13T01:30:00.000Z");
    default:
      return new Date("2026-10-13T01:30:00.000Z");
  }
}

function textFrom(sse: string): string {
  const parts: string[] = [];
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6);
    if (raw === "[DONE]") continue;
    const event = JSON.parse(raw) as { type?: string; delta?: string };
    if (event.type === "text-delta" && event.delta !== undefined) parts.push(event.delta);
  }
  return parts.join("");
}
