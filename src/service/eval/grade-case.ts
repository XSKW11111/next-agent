import { outageSentence } from "../answer/finalize-support-answer";
import { scoreTrials, type PassAtKScore } from "./pass-at-k";

const liveTrialCount = 5;
const earlyCodePattern = "EARLY-[A-Za-z0-9]+";
const trackingLink = /https:\/\/\S+/;
const uuidToken =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;
const unmaskedOrder = /#[A-Za-z0-9]+/g;
const spokenAttribute =
  /\b(?:sku|stock-keeping|price|size|color|colour|rating)\b|\$\d/i;

export const evalCaseIds = [
  "order-found",
  "snow-recommend",
  "early-risers-inside",
  "early-risers-outside",
  "early-risers-explain",
  "handoff-propose",
  "order-miss",
  "order-outage",
  "email-orders",
] as const;

export type EvalCaseId = (typeof evalCaseIds)[number];

export type GradeOrder = {
  readonly orderNumber: string;
  readonly status: string;
};

export type GradeInput = {
  readonly reply: string;
  readonly secondReply?: string;
  readonly toolNames?: readonly string[];
  readonly requestedOrder?: string;
  readonly orders?: readonly GradeOrder[];
};

export function gradeCase(id: EvalCaseId, input: GradeInput): boolean {
  switch (id) {
    case "order-found":
      return gradesOrderFound(input.reply);
    case "snow-recommend":
      return gradesSnowRecommend(input.reply);
    case "early-risers-inside":
      return gradesSameCode(input.reply, input.secondReply);
    case "early-risers-outside":
      return explainsWindow(input.reply) && !hasEarlyCode(input.reply);
    case "early-risers-explain":
      return /early risers/i.test(input.reply) && !hasEarlyCode(input.reply);
    case "handoff-propose":
      return gradesHandoff(input.reply);
    case "order-miss":
      return gradesOrderMiss(input);
    case "order-outage":
      return input.reply.trim() === outageSentence;
    case "email-orders":
      return gradesEmailOrders(input.reply, input.orders);
    default: {
      const unexpected: never = id;
      return unexpected;
    }
  }
}

export function scoreCaseTrials(results: readonly boolean[]): PassAtKScore {
  if (results.length !== liveTrialCount) {
    throw new Error("a live case has 5 trials");
  }
  return scoreTrials(results.filter((passed) => passed).length, liveTrialCount);
}

function gradesOrderFound(reply: string): boolean {
  return reply.includes("#W002") && /shipped/i.test(reply) && trackingLink.test(reply);
}

function gradesSnowRecommend(reply: string): boolean {
  return reply.includes("Summit Pro X Skis") && !spokenAttribute.test(reply);
}

function gradesSameCode(reply: string, secondReply: string | undefined): boolean {
  if (secondReply === undefined) return false;
  const first = singleCode(reply);
  const second = singleCode(secondReply);
  return first !== undefined && first === second;
}

function explainsWindow(reply: string): boolean {
  return reply.includes("08:00-10:00") || reply.includes("08:00–10:00");
}

function gradesHandoff(reply: string): boolean {
  return reply.includes("Confirm") && reply.includes("Cancel") && !uuidToken.test(reply);
}

function gradesOrderMiss(input: GradeInput): boolean {
  if (!input.toolNames?.includes("lookup_order")) return false;
  if (input.reply.trim() === outageSentence) return false;
  const requested = input.requestedOrder?.toUpperCase();
  for (const token of input.reply.match(unmaskedOrder) ?? []) {
    if (token.toUpperCase() !== requested) return false;
  }
  return true;
}

function gradesEmailOrders(reply: string, orders: readonly GradeOrder[] | undefined): boolean {
  if (orders === undefined || orders.length < 2) return false;
  return orders.every(
    (order) => reply.includes(order.orderNumber) && reply.toLowerCase().includes(order.status.toLowerCase()),
  );
}

function hasEarlyCode(reply: string): boolean {
  return new RegExp(earlyCodePattern).test(reply);
}

function singleCode(reply: string): string | undefined {
  const codes = reply.match(new RegExp(earlyCodePattern, "g")) ?? [];
  const code = codes[0];
  if (code === undefined || codes.length !== 1) return undefined;
  return code;
}
