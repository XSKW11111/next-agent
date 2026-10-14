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
  "early-risers-short-accept",
] as const;

export type EvalCaseId = (typeof evalCaseIds)[number];

export type ShortAcceptVariant = "inside" | "outside" | "unresolved";

export type GradeOrder = {
  readonly orderNumber: string;
  readonly status: string;
};

export type GradeLookupResult = {
  readonly kind: string;
  readonly tool?: string;
};

export type GradeInput = {
  readonly reply: string;
  readonly secondReply?: string;
  /** @deprecated Prefer lookupResult from the debug trace. */
  readonly toolNames?: readonly string[];
  readonly lookupResult?: GradeLookupResult;
  readonly requestedOrder?: string;
  readonly orders?: readonly GradeOrder[];
  readonly priorCustomerSentence?: string;
  readonly priorAssistantSentence?: string;
  readonly shortAcceptVariant?: ShortAcceptVariant;
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
    case "early-risers-short-accept":
      return gradesShortAccept(input);
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
  if (!hasLookupMiss(input)) return false;
  if (input.reply.trim() === outageSentence) return false;
  const requested = input.requestedOrder?.toUpperCase();
  for (const token of input.reply.match(unmaskedOrder) ?? []) {
    if (token.toUpperCase() !== requested) return false;
  }
  return true;
}

function hasLookupMiss(input: GradeInput): boolean {
  if (input.lookupResult !== undefined) {
    return input.lookupResult.kind === "order_not_found";
  }
  return input.toolNames?.includes("lookup_order") === true;
}

function gradesEmailOrders(reply: string, orders: readonly GradeOrder[] | undefined): boolean {
  if (orders === undefined || orders.length < 2) return false;
  return orders.every(
    (order) => reply.includes(order.orderNumber) && reply.toLowerCase().includes(order.status.toLowerCase()),
  );
}

function gradesShortAccept(input: GradeInput): boolean {
  const variant = input.shortAcceptVariant;
  if (variant === undefined) return false;
  if (input.secondReply === undefined) return false;
  if (!traceCarriesExplanation(input)) return false;
  if (isFreshMenu(input.secondReply)) return false;

  switch (variant) {
    case "inside":
      return singleCode(input.secondReply) !== undefined;
    case "outside":
      return explainsWindow(input.secondReply) && !hasEarlyCode(input.secondReply);
    case "unresolved":
      return /early risers/i.test(input.secondReply) && !hasEarlyCode(input.secondReply);
    default: {
      const unexpected: never = variant;
      return unexpected;
    }
  }
}

function traceCarriesExplanation(input: GradeInput): boolean {
  const customer = input.priorCustomerSentence ?? "";
  const assistant = input.priorAssistantSentence ?? "";
  return /discount/i.test(customer) && /early risers/i.test(assistant);
}

function isFreshMenu(reply: string): boolean {
  return (
    /\border\b/i.test(reply) ||
    /\bproduct\b/i.test(reply) ||
    (/discount/i.test(reply) && /offer/i.test(reply) && !/yes|claim|code|08:00/i.test(reply))
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
