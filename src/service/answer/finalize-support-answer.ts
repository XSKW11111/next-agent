const outageSentence = "That service is temporarily unavailable.";
const emptyModelSentence = "Something was wrong with the model output, Please try again";

const modelHintKeys = new Set(["unmatched_order_count", "handoff_eligible"]);

const earlyToken = /EARLY-[A-Za-z0-9]+/g;
const uuidToken =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const infrastructureWord = /\b(?:database|redis|sql)\b/i;

type Outage = "all" | "mixed" | "none";

export function finalizeSupportAnswer(input: {
  readonly draft: string;
  readonly toolPayloads: readonly unknown[];
}): string {
  const outage = outageOf(input.toolPayloads);
  const kept =
    outage === "all" ? "" : keptDraft(input.draft, input.toolPayloads);
  switch (outage) {
    case "all":
      return outageSentence;
    case "mixed":
      return kept === "" ? outageSentence : `${outageSentence} ${kept}`;
    case "none":
      return kept === "" ? emptyModelSentence : kept;
    default: {
      const unexpected: never = outage;
      return unexpected;
    }
  }
}

export function isUnsafeSentence(
  sentence: string,
  toolPayloads: readonly unknown[],
): boolean {
  if (infrastructureWord.test(sentence)) return true;
  const facts = factsJson(toolPayloads);
  for (const token of sentence.match(earlyToken) ?? []) {
    if (!tokenIsIssued(facts, token, false)) return true;
  }
  for (const token of sentence.match(uuidToken) ?? []) {
    if (!tokenIsIssued(facts, token, true)) return true;
  }
  return false;
}

function keptDraft(draft: string, toolPayloads: readonly unknown[]): string {
  return splitSentences(draft)
    .filter((sentence) => !isUnsafeSentence(sentence, toolPayloads))
    .join(" ");
}

function splitSentences(draft: string): readonly string[] {
  const trimmed = draft.trim();
  if (trimmed === "") return [];
  return trimmed.split(/(?<=[.!?])\s+/).filter((sentence) => sentence !== "");
}

function outageOf(toolPayloads: readonly unknown[]): Outage {
  if (toolPayloads.length === 0) return "none";
  let unavailable = 0;
  for (const payload of toolPayloads) {
    if (isServiceUnavailable(stripModelHints(payload))) unavailable += 1;
  }
  if (unavailable === toolPayloads.length) return "all";
  if (unavailable > 0) return "mixed";
  return "none";
}

function isServiceUnavailable(payload: unknown): boolean {
  return isRecord(payload) && payload.kind === "service_unavailable";
}

function stripModelHints(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (modelHintKeys.has(key)) continue;
    stripped[key] = value;
  }
  return stripped;
}

function factsJson(toolPayloads: readonly unknown[]): string {
  return toolPayloads
    .map((payload) => JSON.stringify(stripModelHints(payload)))
    .join("\n");
}

function tokenIsIssued(facts: string, token: string, ignoreCase: boolean): boolean {
  const haystack = ignoreCase ? facts.toLowerCase() : facts;
  const needle = ignoreCase ? token.toLowerCase() : token;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const next = haystack[at + needle.length];
    if (next === undefined || !/[A-Za-z0-9]/.test(next)) return true;
    from = at + needle.length;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
