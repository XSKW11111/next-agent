import { gradeCase, scoreCaseTrials, type EvalCaseId } from "./grade-case";

const trialCount = 5;

export type LiveTurn = {
  readonly id: EvalCaseId;
  readonly turns: readonly string[];
  grade(replies: readonly string[]): boolean;
};

export type SkippedLiveCase = {
  readonly id: EvalCaseId;
  readonly skipped: string;
};

export type LiveCaseScore = {
  readonly id: EvalCaseId;
  readonly trials: number;
  readonly passed: number;
  readonly passAt1: number;
  readonly passAt3: number;
  readonly passAll1: number;
  readonly passAll3: number;
  readonly sample: string;
};

export type LiveCaseResult = LiveCaseScore | SkippedLiveCase;

const orderFound = "My email is jane.smith@example.com. Where is order #W002?";
const snow = "What skis do you recommend for snow?";
const claim = "I want to claim the Early Risers discount.";
const explain = "What discounts do you offer?";
const handoff =
  "I want a person to help me. Contact me at person@example.com. The reason is the shipment needs a person.";

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
];

export const skippedLiveCases: readonly SkippedLiveCase[] = [
  {
    id: "order-miss",
    skipped: "The chat reply does not include the tool name, so a miss cannot be scored from the text.",
  },
  {
    id: "order-outage",
    skipped: "The live catalog is reachable, so a normal turn does not produce the outage sentence.",
  },
  {
    id: "email-orders",
    skipped: "The hosted order check names #W002 only, so the two-order reply is not a fixed case.",
  },
];

export async function runLiveCases(
  ask: (turns: readonly string[]) => Promise<readonly string[]>,
): Promise<readonly LiveCaseResult[]> {
  const scored: LiveCaseResult[] = [];
  for (const item of scoredLiveCases) {
    scored.push(await scoreTurns(item, ask));
  }
  return [...scored, ...skippedLiveCases];
}

async function scoreTurns(
  item: LiveTurn,
  ask: (turns: readonly string[]) => Promise<readonly string[]>,
): Promise<LiveCaseScore> {
  const results: boolean[] = [];
  let sample = "";
  for (let trial = 0; trial < trialCount; trial += 1) {
    try {
      const replies = await ask(item.turns);
      const passed = item.grade(replies);
      results.push(passed);
      if (!passed && sample === "") sample = replyAt(replies, 0);
    } catch (error) {
      results.push(false);
      if (sample === "") sample = error instanceof Error ? error.message : "trial failed";
    }
  }
  return { id: item.id, ...scoreCaseTrials(results), sample };
}

function replyAt(replies: readonly string[], index: number): string {
  return replies[index] ?? "";
}
