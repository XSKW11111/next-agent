import type {
  SupportTurnTraceChunkPlan,
  SupportTurnTraceInput,
  SupportTurnTraceOutput,
  SupportTurnTracePriorTurn,
  SupportTurnTraceTimezone,
} from "../../domain/support-turn-trace";
import type { LocalTimezone } from "../../domain/session";
import type { TurnCompletion } from "../agent/support-turn";
import type { StoredSupportMessage } from "../turn/prior-messages";

export function buildTraceInput(input: {
  readonly systemPrompt: string;
  readonly priorMessages: readonly StoredSupportMessage[];
  readonly currentSentence: string;
  readonly summaryText: string | null;
  readonly timezone: LocalTimezone;
}): SupportTurnTraceInput {
  return {
    systemPrompt: input.systemPrompt,
    priorTurns: pairPriorTurns(input.priorMessages),
    currentSentence: input.currentSentence,
    summaryText: input.summaryText,
    timezone: toTraceTimezone(input.timezone),
  };
}

export function buildTraceOutput(completion: TurnCompletion): SupportTurnTraceOutput {
  const toolResults = completion.toolTraces.map((trace, index) => {
    const payload = completion.toolPayloads[index];
    if (payload === undefined) {
      throw new Error("tool payload is missing for a tool trace");
    }
    return {
      callId: trace.callId,
      tool: trace.tool,
      payload,
    };
  });

  return {
    assistantLine: completion.draft,
    toolResults,
    waitingCalls: completion.skippedCalls.map((call) => ({
      callId: call.callId,
      tool: call.tool,
    })),
    chunkPlans: completion.chunkPlans,
  };
}

function toTraceTimezone(timezone: LocalTimezone): SupportTurnTraceTimezone {
  switch (timezone.kind) {
    case "resolved":
      return { kind: "resolved", name: timezone.name };
    case "unresolved":
      return { kind: "unresolved" };
    default: {
      const unexpected: never = timezone;
      return unexpected;
    }
  }
}

function pairPriorTurns(
  messages: readonly StoredSupportMessage[],
): readonly SupportTurnTracePriorTurn[] {
  const turns: SupportTurnTracePriorTurn[] = [];
  let pendingCustomer: string | undefined;
  for (const message of messages) {
    switch (message.role) {
      case "user":
        pendingCustomer = message.content;
        break;
      case "assistant":
        if (pendingCustomer !== undefined) {
          turns.push({ customer: pendingCustomer, assistant: message.content });
          pendingCustomer = undefined;
        }
        break;
      default: {
        const unexpected: never = message;
        return unexpected;
      }
    }
  }
  return turns;
}

export type { SupportTurnTraceChunkPlan };
