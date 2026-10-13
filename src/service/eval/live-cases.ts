import {
  gradeCase,
  scoreCaseTrials,
  type EvalCaseId,
  type GradeInput,
  type GradeOrder,
  type ShortAcceptVariant,
} from "./grade-case";

const trialCount = 5;

export type LiveTrialTrace = {
  readonly traceId: string;
  readonly traceUrl: string;
  readonly lookupResult?: GradeInput["lookupResult"];
  readonly orders?: readonly GradeOrder[];
  readonly priorCustomerSentence?: string;
  readonly priorAssistantSentence?: string;
};

export type LiveAskResult = {
  readonly replies: readonly string[];
  readonly traces: readonly LiveTrialTrace[];
};

export type LiveAskContext = {
  readonly id: EvalCaseId;
  readonly turns: readonly string[];
  readonly variant?: ShortAcceptVariant;
};

export type LiveAsk = (context: LiveAskContext) => Promise<LiveAskResult>;

export type LiveTurn = {
  readonly id: EvalCaseId;
  readonly turns: readonly string[];
  readonly variant?: ShortAcceptVariant;
  grade(replies: readonly string[], traces: readonly LiveTrialTrace[]): boolean;
};

export type LiveCaseScore = {
  readonly id: EvalCaseId;
  readonly variant?: ShortAcceptVariant;
  readonly trials: number;
  readonly passed: number;
  readonly passAt1: number;
  readonly passAt3: number;
  readonly passAll1: number;
  readonly passAll3: number;
  readonly sample: string;
  readonly trialTraces: readonly {
    readonly traceId: string;
    readonly traceUrl: string;
  }[];
};

export type LiveCaseResult = LiveCaseScore;

const orderFound = "My email is jane.smith@example.com. Where is order #W002?";
const orderMiss = "My email is jane.smith@example.com. Where is order #W999?";
const orderOutage = "My email is jane.smith@example.com. Where is order #W002?";
const emailOrders = "My email is jane.smith@example.com. What orders do I have?";
const snow = "What skis do you recommend for snow?";
const claim = "I want to claim the Early Risers discount.";
const explain = "What discounts do you offer?";
const shortYes = "yes";
const handoff =
  "I want a person to help me. Contact me at person@example.com. The reason is the shipment needs a person.";

const emailOrdersFixture: readonly GradeOrder[] = [
  { orderNumber: "#W002", status: "in-transit" },
  { orderNumber: "#W003", status: "processing" },
];

export const scoredLiveCases: readonly LiveTurn[] = [
  {
    id: "order-found",
    turns: [orderFound],
    grade(replies) {
      return gradeCase("order-found", { reply: replyAt(replies, 0) });
    },
  },
  {
    id: "snow-recommend",
    turns: [snow],
    grade(replies) {
      return gradeCase("snow-recommend", { reply: replyAt(replies, 0) });
    },
  },
  {
    id: "early-risers-inside",
    turns: [claim, claim],
    grade(replies) {
      return gradeCase("early-risers-inside", {
        reply: replyAt(replies, 0),
        secondReply: replyAt(replies, 1),
      });
    },
  },
  {
    id: "early-risers-outside",
    turns: [claim],
    grade(replies) {
      return gradeCase("early-risers-outside", { reply: replyAt(replies, 0) });
    },
  },
  {
    id: "early-risers-explain",
    turns: [explain],
    grade(replies) {
      return gradeCase("early-risers-explain", { reply: replyAt(replies, 0) });
    },
  },
  {
    id: "handoff-propose",
    turns: [handoff],
    grade(replies) {
      return gradeCase("handoff-propose", { reply: replyAt(replies, 0) });
    },
  },
  {
    id: "order-miss",
    turns: [orderMiss],
    grade(replies, traces) {
      const trace = traces.at(-1);
      return gradeCase("order-miss", {
        reply: replyAt(replies, 0),
        lookupResult: trace?.lookupResult,
        requestedOrder: "#W999",
      });
    },
  },
  {
    id: "order-outage",
    turns: [orderOutage],
    grade(replies) {
      return gradeCase("order-outage", { reply: replyAt(replies, 0) });
    },
  },
  {
    id: "email-orders",
    turns: [emailOrders],
    grade(replies, traces) {
      const trace = traces.at(-1);
      return gradeCase("email-orders", {
        reply: replyAt(replies, 0),
        orders: trace?.orders ?? emailOrdersFixture,
      });
    },
  },
  {
    id: "early-risers-short-accept",
    variant: "inside",
    turns: [explain, shortYes],
    grade(replies, traces) {
      return gradeShort("inside", replies, traces);
    },
  },
  {
    id: "early-risers-short-accept",
    variant: "outside",
    turns: [explain, shortYes],
    grade(replies, traces) {
      return gradeShort("outside", replies, traces);
    },
  },
  {
    id: "early-risers-short-accept",
    variant: "unresolved",
    turns: [explain, shortYes],
    grade(replies, traces) {
      return gradeShort("unresolved", replies, traces);
    },
  },
];

/** @deprecated Skipped cases are retired; kept empty for callers that still import the name. */
export const skippedLiveCases: readonly never[] = [];

export async function runLiveCases(ask: LiveAsk): Promise<readonly LiveCaseResult[]> {
  const scored: LiveCaseResult[] = [];
  for (const item of scoredLiveCases) {
    scored.push(await scoreTurns(item, ask));
  }
  return scored;
}

export function langsmithTraceUrl(project: string, runId: string): string {
  return `https://smith.langchain.com/o/default/projects/p/${encodeURIComponent(project)}/r/${encodeURIComponent(runId)}`;
}

async function scoreTurns(item: LiveTurn, ask: LiveAsk): Promise<LiveCaseScore> {
  const results: boolean[] = [];
  const trialTraces: { traceId: string; traceUrl: string }[] = [];
  let sample = "";
  for (let trial = 0; trial < trialCount; trial += 1) {
    try {
      const asked = await ask({
        id: item.id,
        turns: item.turns,
        ...(item.variant === undefined ? {} : { variant: item.variant }),
      });
      const passed = item.grade(asked.replies, asked.traces);
      results.push(passed);
      const last = asked.traces.at(-1);
      if (last !== undefined) {
        trialTraces.push({ traceId: last.traceId, traceUrl: last.traceUrl });
      }
      if (!passed && sample === "") sample = replyAt(asked.replies, 0);
    } catch (error) {
      results.push(false);
      if (sample === "") sample = error instanceof Error ? error.message : "trial failed";
    }
  }
  return {
    id: item.id,
    ...(item.variant === undefined ? {} : { variant: item.variant }),
    ...scoreCaseTrials(results),
    sample,
    trialTraces,
  };
}

function gradeShort(
  variant: ShortAcceptVariant,
  replies: readonly string[],
  traces: readonly LiveTrialTrace[],
): boolean {
  const second = traces.at(1);
  return gradeCase("early-risers-short-accept", {
    reply: replyAt(replies, 0),
    secondReply: replyAt(replies, 1),
    shortAcceptVariant: variant,
    priorCustomerSentence: second?.priorCustomerSentence,
    priorAssistantSentence: second?.priorAssistantSentence,
  });
}

function replyAt(replies: readonly string[], index: number): string {
  return replies[index] ?? "";
}
