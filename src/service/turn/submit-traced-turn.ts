import type { SupportTurnTraceInput, SupportTurnTraceOutput } from "../../domain/support-turn-trace";
import { parseTurn, type Turn } from "../../domain/turn";
import type { LangSmithTraceConfig } from "../../infra/langsmith/trace-config";
import type { LangSmithRunsPort } from "../../infra/langsmith/langsmith-runs-port";
import { withTurnTraceContext, type TraceObservation } from "../../infra/langsmith/turn-trace-context";
import {
  runSupportTurn,
  type ScriptedModel,
  type TurnCompletion,
} from "../agent/support-turn";
import { supportSystemPrompt } from "../agent/prompts/system";
import { buildTraceInput, buildTraceOutput } from "../trace/build-trace-io";
import { customerToolCards } from "../tool/customer-tool-cards";
import type { MessageStore, TurnMessage } from "./message-store";
import { priorContext } from "./prior-messages";
import { logStep } from "./step-log";
import type { SubmitTurnInput } from "./submit-turn";

export type TurnTracingSession = {
  readonly config: LangSmithTraceConfig;
  readonly client: LangSmithRunsPort;
  readonly beginRootRun: (input: {
    readonly sessionId: string;
    readonly turnId: string;
  }) => Promise<{ readonly rootRunId: string }>;
  readonly flushObservations: (rootRunId: string, observations: readonly TraceObservation[]) => Promise<number>;
  readonly finalizeRootRun: (input: {
    readonly rootRunId: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly traceInput: SupportTurnTraceInput;
    readonly traceOutput: SupportTurnTraceOutput;
    readonly stepTimingsMs: Readonly<Record<string, number>>;
    readonly observationFailures: number;
    readonly providerCalls: number;
    readonly modelCalls: number;
    readonly embeddingCalls: number;
    readonly toolCalls: number;
    readonly skippedToolCalls?: number;
    readonly toolOutcomes: Readonly<Record<"success" | "unavailable" | "error", number>>;
    readonly providerOutcomes: Readonly<Record<"success" | "error", number>>;
    readonly observedUsage: Readonly<Record<string, number>>;
    readonly tokenUsageComplete: boolean;
    readonly costUsageComplete: boolean;
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
      readonly stepTimingsMs: Readonly<Record<string, number>>;
    }
  | { readonly kind: "reply"; readonly reply: string; readonly langsmithRunId: null }
  | { readonly kind: "rejected" }
  | { readonly kind: "already_submitted" };

export type SubmitTracedTurnInput = Omit<SubmitTurnInput, never> & {
  readonly tracing: TurnTracingSession;
};

export function createTurnTracingSession(input: {
  readonly config: LangSmithTraceConfig;
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
        tags: ["next-agent", "support-turn"],
      });
      return { rootRunId: runId };
    },
    async flushObservations(rootRunId, observations) {
      const runIds = new Map<string, Promise<string | undefined>>();
      let failures = 0;
      let activeWrites = 0;
      const waiting: Array<() => void> = [];
      async function write(parentRunId: string, observation: TraceObservation): Promise<string> {
        if (activeWrites >= 8) {
          await new Promise<void>((resolve) => waiting.push(resolve));
        } else {
          activeWrites += 1;
        }
        try {
          return (await input.client.writeObservation(parentRunId, observation)).runId;
        } finally {
          const next = waiting.shift();
          if (next === undefined) activeWrites -= 1;
          else next();
        }
      }
      for (const observation of [...observations].sort((a, b) => a.sequence - b.sequence)) {
        const parent = observation.parentId === null
          ? Promise.resolve(rootRunId)
          : runIds.get(observation.parentId);
        const run = (async () => {
          const parentRunId = await parent;
          if (parentRunId === undefined) {
            failures += 1;
            return undefined;
          }
          try {
            return await write(parentRunId, observation);
          } catch {
            failures += 1;
            return undefined;
          }
        })();
        runIds.set(observation.id, run);
      }
      await Promise.all(runIds.values());
      return failures;
    },
    async finalizeRootRun(finalize) {
      await input.client.patchRun(finalize.rootRunId, {
        inputs: finalize.traceInput,
        outputs: finalize.traceOutput,
        extra: {
          sessionId: finalize.sessionId,
          turnId: finalize.turnId,
          stepTimingsMs: finalize.stepTimingsMs,
          observationFailures: finalize.observationFailures,
          providerCalls: finalize.providerCalls,
          modelCalls: finalize.modelCalls,
          embeddingCalls: finalize.embeddingCalls,
          toolCalls: finalize.toolCalls,
          ...(finalize.skippedToolCalls === undefined ? {} : { skippedToolCalls: finalize.skippedToolCalls }),
          toolOutcomes: finalize.toolOutcomes,
          providerOutcomes: finalize.providerOutcomes,
          observedUsage: finalize.observedUsage,
          tokenUsageComplete: finalize.tokenUsageComplete,
          costUsageComplete: finalize.costUsageComplete,
        },
        ...(finalize.error === undefined ? {} : { error: finalize.error }),
        end: true,
      });
    },
  };
}

export async function submitTracedTurn(
  input: SubmitTracedTurnInput,
): Promise<SubmitTracedTurnResult> {
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
  const observations: TraceObservation[] = [];
  let observationsFlushed = false;
  let observationFailures = 0;
  const promptCapture = { value: supportSystemPrompt };
  let historyMessages: Awaited<ReturnType<typeof priorContext>>["messages"] = [];

  try {
    return await withTurnTraceContext({ rootRunId, stepTimingsMs, observations, nextObservationSequence: 0 }, async () => {
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
      const traceOutput = buildTraceOutput(completion);
      const finalizedStepTimingsMs = Object.fromEntries(stepTimingsMs);
      observationsFlushed = true;
      observationFailures = await input.tracing.flushObservations(rootRunId, observations);
      await input.tracing.finalizeRootRun({
        rootRunId,
        sessionId: turn.sessionId,
        turnId: turn.id,
        traceInput,
        traceOutput,
        stepTimingsMs: finalizedStepTimingsMs,
        observationFailures,
        ...traceMetrics(observations, observationFailures, traceOutput.waitingCalls.length),
      });

      return {
        kind: "reply" as const,
        reply: completion.draft,
        langsmithRunId: rootRunId,
        completion,
        traceInput,
        stepTimingsMs: finalizedStepTimingsMs,
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
    if (!observationsFlushed) {
      observationFailures = await input.tracing.flushObservations(rootRunId, observations);
    }
    await input.tracing.finalizeRootRun({
      rootRunId,
      sessionId: turn.sessionId,
      turnId: turn.id,
      traceInput: buildTraceInput({
        systemPrompt: promptCapture.value,
        priorMessages: historyMessages,
        currentSentence: turn.text,
        summaryText: null,
        timezone: input.dependencies.promotion.session.localTimezone,
      }),
      traceOutput: emptyOutput,
      stepTimingsMs: Object.fromEntries(stepTimingsMs),
      observationFailures,
      ...traceMetrics(observations, observationFailures),
      error: message,
    });
    throw error;
  }
}

function traceMetrics(observations: readonly TraceObservation[], observationFailures: number, skippedToolCalls?: number): {
  readonly providerCalls: number;
  readonly modelCalls: number;
  readonly embeddingCalls: number;
  readonly toolCalls: number;
  readonly skippedToolCalls?: number;
  readonly toolOutcomes: Readonly<Record<"success" | "unavailable" | "error", number>>;
  readonly providerOutcomes: Readonly<Record<"success" | "error", number>>;
  readonly observedUsage: Readonly<Record<string, number>>;
  readonly tokenUsageComplete: boolean;
  readonly costUsageComplete: boolean;
} {
  const providers = observations.filter((observation) => observation.kind === "model" || observation.kind === "embedding");
  const tools = observations.filter((observation) => observation.kind === "tool");
  const observedUsage: Record<string, number> = {};
  const usageKeys = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheWriteTokens", "audioInputTokens", "imageInputTokens", "videoInputTokens", "reasoningOutputTokens", "audioOutputTokens", "imageOutputTokens", "totalCost"] as const;
  for (const provider of providers) {
    for (const key of usageKeys) {
      const value = provider.usage?.[key];
      if (value !== undefined) observedUsage[key] = (observedUsage[key] ?? 0) + value;
    }
  }
  return {
    providerCalls: providers.length,
    modelCalls: providers.filter((observation) => observation.kind === "model").length,
    embeddingCalls: providers.filter((observation) => observation.kind === "embedding").length,
    toolCalls: tools.length,
    ...(skippedToolCalls === undefined ? {} : { skippedToolCalls }),
    toolOutcomes: {
      success: tools.filter((observation) => observation.outcome === "success").length,
      unavailable: tools.filter((observation) => observation.outcome === "unavailable").length,
      error: tools.filter((observation) => observation.outcome === "error").length,
    },
    providerOutcomes: {
      success: providers.filter((observation) => observation.outcome === "success").length,
      error: providers.filter((observation) => observation.outcome === "error").length,
    },
    observedUsage,
    tokenUsageComplete: providers.length > 0 && observationFailures === 0 && providers.every((observation) => observation.usage?.totalTokens !== undefined),
    costUsageComplete: providers.length > 0 && observationFailures === 0 && providers.every((observation) => observation.usage?.totalCost !== undefined),
  };
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
