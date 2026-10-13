import type { SupportTurnTraceInput, SupportTurnTraceOutput } from "../../domain/support-turn-trace";
import { parseTurn, type Turn } from "../../domain/turn";
import type { DebugTraceConfig } from "../../infra/langsmith/debug-trace-config";
import type { LangSmithRunsPort } from "../../infra/langsmith/langsmith-runs-port";
import { withTurnTraceContext } from "../../infra/langsmith/turn-trace-context";
import {
  runSupportTurn,
  type ScriptedModel,
  type SupportTurnDependencies,
  type TurnCompletion,
} from "../agent/support-turn";
import { supportSystemPrompt } from "../agent/prompts/system";
import { buildTraceInput, buildTraceOutput } from "../trace/build-trace-io";
import { customerToolCards, type ToolCardStore } from "../tool/customer-tool-cards";
import type { MessageStore, TurnMessage } from "./message-store";
import { priorContext } from "./prior-messages";
import { logStep } from "./step-log";
import type { SubmitTurnInput } from "./submit-turn";

export type TurnTracingSession = {
  readonly config: DebugTraceConfig;
  readonly client: LangSmithRunsPort;
  readonly beginRootRun: (input: {
    readonly sessionId: string;
    readonly turnId: string;
  }) => Promise<{ readonly rootRunId: string }>;
  readonly finalizeRootRun: (input: {
    readonly rootRunId: string;
    readonly traceInput: SupportTurnTraceInput;
    readonly traceOutput: SupportTurnTraceOutput;
    readonly stepTimingsMs: Readonly<Record<string, number>>;
    readonly error?: string;
  }) => Promise<void>;
};

export type SubmitTracedTurnResult =
  | {
      readonly kind: "reply";
      readonly reply: string;
      readonly langsmithRunId: string;
      readonly completion: TurnCompletion;
      readonly traceInput: SupportTurnTraceInput;
    }
  | { readonly kind: "reply"; readonly reply: string; readonly langsmithRunId: null }
  | { readonly kind: "rejected" }
  | { readonly kind: "already_submitted" };

export type SubmitTracedTurnInput = Omit<SubmitTurnInput, never> & {
  readonly tracing: TurnTracingSession;
};

export function createTurnTracingSession(input: {
  readonly config: DebugTraceConfig;
  readonly client: LangSmithRunsPort;
}): TurnTracingSession {
  return {
    config: input.config,
    client: input.client,
    async beginRootRun({ sessionId, turnId }) {
      const { runId } = await input.client.createRootRun({
        name: "support-turn",
        project: input.config.project,
        sessionId,
        turnId,
        tags: ["next-agent", "debug-trace"],
      });
      return { rootRunId: runId };
    },
    async finalizeRootRun(finalize) {
      await input.client.patchRun(finalize.rootRunId, {
        inputs: finalize.traceInput,
        outputs: finalize.traceOutput,
        extra: { stepTimingsMs: finalize.stepTimingsMs },
        ...(finalize.error === undefined ? {} : { error: finalize.error }),
        end: true,
      });
    },
  };
}

/** Same idempotency as submitTurn; opens one root run only on the new-turn path. */
export async function submitTracedTurn(
  input: SubmitTracedTurnInput,
): Promise<SubmitTracedTurnResult> {
  if (!input.tracing.config.enabled) {
    throw new Error("submitTracedTurn requires debug tracing to be enabled");
  }

  const turn = parseTurn({
    id: input.turnId,
    sessionId: input.sessionId,
    text: input.text,
  });
  if (!turn.ok) {
    throw new Error("turn is invalid");
  }

  const recorded = recordTurn(await input.messages.messagesForTurn(turn.value.sessionId, turn.value.id));
  switch (recorded.kind) {
    case "saved":
      if (recorded.text !== turn.value.text) return { kind: "rejected" };
      return { kind: "reply", reply: recorded.reply, langsmithRunId: null };
    case "submitted":
      return { kind: "already_submitted" };
    case "new":
      return saveTracedTurn(input, turn.value);
    default: {
      const unexpected: never = recorded;
      return unexpected;
    }
  }
}

async function saveTracedTurn(
  input: SubmitTracedTurnInput,
  turn: Turn,
): Promise<SubmitTracedTurnResult> {
  const { rootRunId } = await input.tracing.beginRootRun({
    sessionId: turn.sessionId,
    turnId: turn.id,
  });

  const stepTimingsMs = new Map<string, number>();
  const promptCapture = { value: supportSystemPrompt };
  let historyMessages: Awaited<ReturnType<typeof priorContext>>["messages"] = [];

  try {
    return await withTurnTraceContext({ rootRunId, stepTimingsMs }, async () => {
      const insertCustomerStarted = performance.now();
      await insertRow(input.messages, {
        sessionId: turn.sessionId,
        turnId: turn.id,
        role: "customer",
        content: turn.text,
      });
      logStep("insert-customer", insertCustomerStarted);

      const priorStarted = performance.now();
      const history = priorContext(
        await input.messages.messagesForSession(turn.sessionId),
        turn.id,
      );
      historyMessages = history.messages;
      logStep("prior-context", priorStarted);

      const graphStarted = performance.now();
      const completion = await runSupportTurn({
        model: captureSystemPrompt(input.model, promptCapture),
        sessionId: turn.sessionId,
        threadId: turn.sessionId,
        customerText: turn.text,
        priorMessages: history.messages,
        priorSummary: history.summary,
        priorSequences: history.sequences,
        dependencies: input.dependencies,
        ...(input.maxToolRounds === undefined ? {} : { maxToolRounds: input.maxToolRounds }),
        ...(input.productMatchThreshold === undefined
          ? {}
          : { productMatchThreshold: input.productMatchThreshold }),
        ...(input.maxProductCandidates === undefined
          ? {}
          : { maxProductCandidates: input.maxProductCandidates }),
      });
      logStep("support-graph", graphStarted);

      const insertAssistantStarted = performance.now();
      await insertRow(input.messages, {
        sessionId: turn.sessionId,
        turnId: turn.id,
        role: "assistant",
        content: completion.draft,
      });
      if (completion.contextSummary !== null) {
        await input.messages.insert({
          sessionId: turn.sessionId,
          turnId: turn.id,
          role: "summary",
          content: completion.contextSummary.summary,
          sequence: completion.contextSummary.coveredThrough,
        });
      }
      if (input.toolCards !== undefined) {
        const cards = customerToolCards(completion.toolPayloads);
        if (cards.length > 0) input.toolCards.save(turn.sessionId, turn.id, cards);
      }
      logStep("insert-assistant", insertAssistantStarted);

      const traceInput = buildTraceInput({
        systemPrompt: promptCapture.value,
        priorMessages: history.messages,
        currentSentence: turn.text,
        summaryText: completion.contextSummary?.summary ?? null,
        timezone: input.dependencies.promotion.session.localTimezone,
      });
      await input.tracing.finalizeRootRun({
        rootRunId,
        traceInput,
        traceOutput: buildTraceOutput(completion),
        stepTimingsMs: Object.fromEntries(stepTimingsMs),
      });

      return {
        kind: "reply" as const,
        reply: completion.draft,
        langsmithRunId: rootRunId,
        completion,
        traceInput,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "support turn failed";
    const emptyOutput: SupportTurnTraceOutput = {
      assistantLine: "",
      toolResults: [],
      waitingCalls: [],
      chunkPlans: [],
    };
    await input.tracing.finalizeRootRun({
      rootRunId,
      traceInput: buildTraceInput({
        systemPrompt: promptCapture.value,
        priorMessages: historyMessages,
        currentSentence: turn.text,
        summaryText: null,
        timezone: input.dependencies.promotion.session.localTimezone,
      }),
      traceOutput: emptyOutput,
      stepTimingsMs: Object.fromEntries(stepTimingsMs),
      error: message,
    });
    throw error;
  }
}

function captureSystemPrompt(
  model: ScriptedModel,
  slot: { value: string },
): ScriptedModel {
  const summarize = model.summarize?.bind(model);
  return {
    complete(input) {
      slot.value = input.systemPrompt;
      return model.complete(input);
    },
    ...(summarize === undefined ? {} : { summarize }),
  };
}

async function insertRow(
  messages: MessageStore,
  row: Omit<TurnMessage, "sequence">,
): Promise<void> {
  const sequence = await takeSequence(messages, row.sessionId);
  await messages.insert({ ...row, sequence });
}

async function takeSequence(messages: MessageStore, sessionId: TurnMessage["sessionId"]): Promise<number> {
  const claimed = await claimSequence(messages, sessionId);
  if (claimed !== undefined) return claimed;
  const retried = await claimSequence(messages, sessionId);
  if (retried !== undefined) return retried;
  throw new Error("next message sequence is contested");
}

async function claimSequence(
  messages: MessageStore,
  sessionId: TurnMessage["sessionId"],
): Promise<number | undefined> {
  const expected = await messages.readNextSequence(sessionId);
  const updated = await messages.conditionalUpdate(sessionId, expected);
  switch (updated.kind) {
    case "updated":
      return updated.sequence;
    case "unchanged":
      return undefined;
    default: {
      const unexpected: never = updated;
      return unexpected;
    }
  }
}

type RecordedTurn =
  | { readonly kind: "new" }
  | { readonly kind: "submitted" }
  | { readonly kind: "saved"; readonly text: string; readonly reply: string };

function recordTurn(messages: readonly TurnMessage[]): RecordedTurn {
  let customer: TurnMessage | undefined;
  let assistant: TurnMessage | undefined;
  for (const message of messages) {
    switch (message.role) {
      case "customer":
        customer ??= message;
        break;
      case "assistant":
        assistant ??= message;
        break;
      case "summary":
        break;
      default: {
        const unexpected: never = message.role;
        return unexpected;
      }
    }
  }
  if (customer !== undefined && assistant !== undefined) {
    return { kind: "saved", text: customer.content, reply: assistant.content };
  }
  if (customer !== undefined || assistant !== undefined) return { kind: "submitted" };
  return { kind: "new" };
}
