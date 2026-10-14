import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { handoffResultSchema, type HandoffResult } from "../../domain/handoff";
import { parse } from "../../domain/parse";
import {
  sessionIdSchema,
  type SessionId,
  type UnmatchedOrderStreak,
} from "../../domain/session";
import { finalizeSupportAnswer } from "../answer/finalize-support-answer";
import { runToolRound, type ToolCall, type ToolName } from "../tool/run-tool-round";
import { maxCallsPerChunk, skippedChecksSentence } from "../tool/tool-chunk-plan";
import { runSupportTool, type SupportToolDependencies } from "../tool/support-tools";
import type { StoredSupportMessage } from "../turn/prior-messages";
import {
  compactHistory,
  contextWindowTokens,
  type CompactMessage,
  type RunningSummary,
} from "./context-summary";
import { supportSystemPrompt } from "./prompts/system";

const defaultMaxToolRounds = 6;

const toolNameSchema = z.enum([
  "lookup_order",
  "search_products",
  "claim_early_risers",
  "capture_handoff",
]);

const toolCallSchema = z.strictObject({
  id: z.string().min(1),
  name: toolNameSchema,
  args: z.unknown(),
});

const replySchema = z.strictObject({
  text: z.string(),
  toolCalls: z.array(toolCallSchema).optional(),
});

const customerTextSchema = z.string().trim().min(1);

export class SupportTurnRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportTurnRejected";
  }
}

export type ModelToolCall = z.infer<typeof toolCallSchema>;

export type SupportMessage =
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls: readonly ModelToolCall[];
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly name: ToolName;
      readonly content: string;
    };

export type ScriptedModel = {
  complete(input: {
    readonly systemPrompt: string;
    readonly messages: readonly SupportMessage[];
  }): ScriptedReply | Promise<ScriptedReply>;
  summarize?(prompt: string): Promise<string>;
};

export type ScriptedReply = {
  readonly text: string;
  readonly toolCalls?: readonly ModelToolCall[];
};

export type ToolTrace = {
  readonly callId: string;
  readonly tool: ToolName;
};

export type SkippedToolCall = {
  readonly callId: string;
  readonly tool: ToolName;
  readonly args: unknown;
};

export type HandoffDraft = HandoffResult["draft"];

export type TurnCompletion = {
  readonly draft: string;
  readonly toolPayloads: readonly unknown[];
  readonly toolTraces: readonly ToolTrace[];
  readonly skippedCalls: readonly SkippedToolCall[];
  readonly unmatchedOrderCount: UnmatchedOrderStreak;
  readonly handoffDraft: HandoffDraft | undefined;
  readonly contextSummary: { readonly summary: string; readonly coveredThrough: number } | null;
};

export type SupportTurnDependencies = SupportToolDependencies;

export type SupportTurnInput = {
  readonly model: ScriptedModel;
  readonly sessionId: string;
  readonly customerText: string;
  readonly priorMessages: readonly StoredSupportMessage[];
  readonly priorSummary?: string | null;
  readonly priorSequences?: readonly number[];
  readonly contextWindowTokens?: number;
  readonly dependencies: SupportTurnDependencies;
  readonly threadId?: string;
  readonly signal?: AbortSignal;
  readonly maxToolRounds?: number;
  readonly productMatchThreshold?: number;
  readonly maxProductCandidates?: number;
};

type HeldHandoff =
  | { readonly kind: "none" }
  | { readonly kind: "held"; readonly draft: HandoffDraft };

type TurnChannels = {
  messages: SupportMessage[];
  draft: string;
  toolRounds: number;
  pendingQueue: ModelToolCall[];
  toolPayloads: unknown[];
  toolTraces: ToolTrace[];
  unmatchedOrderCount: UnmatchedOrderStreak;
  heldHandoff: HeldHandoff;
  summary: string;
  keptFrom: number;
  lineages: number[];
};

const TurnState = Annotation.Root({
  messages: Annotation<SupportMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  draft: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  toolRounds: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  pendingQueue: Annotation<ModelToolCall[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  toolPayloads: Annotation<unknown[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  toolTraces: Annotation<ToolTrace[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  unmatchedOrderCount: Annotation<UnmatchedOrderStreak>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  heldHandoff: Annotation<HeldHandoff>({
    reducer: keepFirstHandoff,
    default: () => ({ kind: "none" }),
  }),
  summary: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  keptFrom: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  lineages: Annotation<number[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
});

type ReadyTurn = {
  readonly model: ScriptedModel;
  readonly sessionId: SessionId;
  readonly signal: AbortSignal | undefined;
  readonly maxToolRounds: number;
  readonly productMatchThreshold: number | undefined;
  readonly maxProductCandidates: number | undefined;
  readonly contextWindowTokens: number;
  readonly dependencies: SupportTurnDependencies;
};

function seedSupportMessages(
  priorMessages: readonly StoredSupportMessage[],
  customerText: string,
): readonly SupportMessage[] {
  return [...priorMessages, { role: "user", content: customerText }];
}

export async function runSupportTurn(input: SupportTurnInput): Promise<TurnCompletion> {
  throwIfAborted(input.signal);
  if (input.threadId !== undefined && input.threadId !== input.sessionId) {
    throw new SupportTurnRejected("thread_id does not match session id");
  }

  const sessionId = requireSessionId(input.sessionId);
  const customerText = requireCustomerText(input.customerText);
  const maxToolRounds = requireMaxToolRounds(input.maxToolRounds);
  const streak = await input.dependencies.orders.streaks.read(sessionId);
  if (streak.kind === "unavailable") {
    throw new SupportTurnRejected("unmatched order streak is unavailable");
  }
  throwIfAborted(input.signal);

  const graph = compileSupportGraph({
    model: input.model,
    sessionId,
    signal: input.signal,
    maxToolRounds,
    productMatchThreshold: input.productMatchThreshold,
    maxProductCandidates: input.maxProductCandidates,
    contextWindowTokens: input.contextWindowTokens ?? contextWindowTokens,
    dependencies: input.dependencies,
  });
  const seeded = [...seedSupportMessages(input.priorMessages, customerText)];
  const state = await graph.invoke(
    {
      messages: seeded,
      summary: input.priorSummary ?? "",
      lineages: seedLineages(input.priorSequences, seeded.length),
      unmatchedOrderCount: streak.streak,
    },
    {
      recursionLimit: maxToolRounds * 2 + 2,
      signal: input.signal,
      configurable: { thread_id: sessionId },
    },
  );

  const finalized = finalizeSupportAnswer({
    draft: state.draft,
    toolPayloads: state.toolPayloads,
  });
  const skippedCalls = state.pendingQueue.map((call) => ({
    callId: call.id,
    tool: call.name,
    args: call.args,
  }));
  return {
    draft:
      skippedCalls.length === 0
        ? finalized
        : `${finalized} ${skippedChecksSentence(skippedCalls)}`,
    toolPayloads: state.toolPayloads,
    toolTraces: state.toolTraces,
    skippedCalls,
    unmatchedOrderCount: state.unmatchedOrderCount,
    handoffDraft: heldDraft(state.heldHandoff),
    contextSummary: savedSummary(state, input.priorSummary ?? ""),
  };
}

function compileSupportGraph(ready: ReadyTurn) {
  return new StateGraph(TurnState)
    .addNode("summarize", (state: TurnChannels) => summarizeNode(state, ready))
    .addNode("agent", (state: TurnChannels) => agentNode(state, ready))
    .addNode("tools", (state: TurnChannels) => toolsNode(state, ready))
    .addEdge(START, "summarize")
    .addEdge("summarize", "agent")
    .addConditionalEdges("agent", (state: TurnChannels) => routeAfterAgent(state, ready), [
      "tools",
      END,
    ])
    .addConditionalEdges("tools", (state: TurnChannels) => routeAfterTools(state, ready), [
      "tools",
      "agent",
      END,
    ])
    .compile();
}

async function summarizeNode(state: TurnChannels, ready: ReadyTurn): Promise<Partial<TurnChannels>> {
  throwIfAborted(ready.signal);
  const summarize = ready.model.summarize?.bind(ready.model);
  const compacted = await compactHistory({
    systemPrompt: supportSystemPrompt,
    messages: compactMessages(state),
    runningSummary: runningSummary(state.summary),
    windowTokens: ready.contextWindowTokens,
    summarize: summarize ?? (async () => {
      throw new SupportTurnRejected("summary model is unavailable");
    }),
  });
  throwIfAborted(ready.signal);
  return {
    summary: compacted.summary?.summary ?? "",
    keptFrom: compacted.keptFrom,
  };
}

async function agentNode(state: TurnChannels, ready: ReadyTurn): Promise<Partial<TurnChannels>> {
  throwIfAborted(ready.signal);
  const reply = await ready.model.complete({
    systemPrompt: systemPromptWithSummary(state.summary),
    messages: state.messages.slice(state.keptFrom),
  });
  throwIfAborted(ready.signal);
  const parsed = replySchema.safeParse(reply);
  if (!parsed.success) {
    throw new SupportTurnRejected("scripted model reply is invalid");
  }

  const toolCalls = parsed.data.toolCalls ?? [];
  return {
    messages: [
      {
        role: "assistant",
        content: parsed.data.text,
        toolCalls,
      },
    ],
    draft: parsed.data.text,
    pendingQueue: toolCalls,
  };
}

function routeAfterAgent(state: TurnChannels, ready: ReadyTurn): "tools" | typeof END {
  if (state.pendingQueue.length === 0) return END;
  if (state.toolRounds >= ready.maxToolRounds) return END;
  return "tools";
}

async function toolsNode(state: TurnChannels, ready: ReadyTurn): Promise<Partial<TurnChannels>> {
  throwIfAborted(ready.signal);
  const chunk = state.pendingQueue.slice(0, maxCallsPerChunk);
  if (chunk.length === 0) throw new SupportTurnRejected("tools node has no calls");

  const calls: ToolCall<unknown>[] = chunk.map((call) => ({
    tool: call.name,
    run: () => runCall(call, ready),
  }));
  const round = await runToolRound(calls);
  if (!round.ok) {
    switch (round.reason) {
      case "too_many_calls":
        throw new SupportTurnRejected("too many tool calls");
      default: {
        const unexpected: never = round.reason;
        throw new SupportTurnRejected(unexpected);
      }
    }
  }

  return {
    messages: chunk.map((call, index) => {
      const payload = round.results[index];
      if (payload === undefined) throw new SupportTurnRejected("tool result is missing");
      return {
        role: "tool" as const,
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(payload),
      };
    }),
    pendingQueue: state.pendingQueue.slice(maxCallsPerChunk),
    toolRounds: state.toolRounds + 1,
    toolPayloads: [...round.results],
    toolTraces: chunk.map((call) => ({ callId: call.id, tool: call.name })),
    unmatchedOrderCount: latestUnmatched(round.results, state.unmatchedOrderCount),
    heldHandoff: firstHandoff(round.results),
  };
}

function routeAfterTools(state: TurnChannels, ready: ReadyTurn): "tools" | "agent" | typeof END {
  if (state.pendingQueue.length > 0 && state.toolRounds < ready.maxToolRounds) return "tools";
  if (state.toolRounds < ready.maxToolRounds) return "agent";
  return END;
}

function runCall(call: ModelToolCall, ready: ReadyTurn): Promise<unknown> {
  return runSupportTool({
    name: call.name,
    args: call.args,
    sessionId: ready.sessionId,
    signal: ready.signal,
    dependencies: ready.dependencies,
    ...(ready.productMatchThreshold === undefined
      ? {}
      : { productMatchThreshold: ready.productMatchThreshold }),
    ...(ready.maxProductCandidates === undefined
      ? {}
      : { maxProductCandidates: ready.maxProductCandidates }),
  });
}

function latestUnmatched(
  payloads: readonly unknown[],
  current: UnmatchedOrderStreak,
): UnmatchedOrderStreak {
  let count = current;
  for (const payload of payloads) {
    const next = unmatchedCount(payload);
    if (next !== undefined) count = next;
  }
  return count;
}

function unmatchedCount(payload: unknown): UnmatchedOrderStreak | undefined {
  if (typeof payload !== "object" || payload === null || !("unmatched_order_count" in payload)) {
    return undefined;
  }
  switch (payload.unmatched_order_count) {
    case 0:
    case 1:
    case 2:
      return payload.unmatched_order_count;
    default:
      return undefined;
  }
}

function firstHandoff(payloads: readonly unknown[]): HeldHandoff {
  for (const payload of payloads) {
    const parsed = handoffResultSchema.safeParse(payload);
    if (parsed.success) return { kind: "held", draft: parsed.data.draft };
  }
  return { kind: "none" };
}

function keepFirstHandoff(left: HeldHandoff, right: HeldHandoff): HeldHandoff {
  switch (left.kind) {
    case "held":
      return left;
    case "none":
      return right;
    default: {
      const unexpected: never = left;
      return unexpected;
    }
  }
}

function heldDraft(held: HeldHandoff): HandoffDraft | undefined {
  switch (held.kind) {
    case "held":
      return held.draft;
    case "none":
      return undefined;
    default: {
      const unexpected: never = held;
      return unexpected;
    }
  }
}

function seedLineages(sequences: readonly number[] | undefined, length: number): number[] {
  return Array.from({ length }, (_item, index) => sequences?.[index] ?? -1);
}

function compactMessages(state: TurnChannels): CompactMessage[] {
  return state.messages.map((message, index) => ({
    id: messageId(state.lineages[index], index),
    role: message.role,
    content: message.content,
  }));
}

function messageId(sequence: number | undefined, index: number): string {
  if (sequence === undefined || sequence < 0) return `live:${index}`;
  return `seq:${sequence}`;
}

function runningSummary(summary: string): RunningSummary | null {
  if (summary.length === 0) return null;
  return { summary, summarizedIds: [] };
}

function systemPromptWithSummary(summary: string): string {
  if (summary.length === 0) return supportSystemPrompt;
  return `${supportSystemPrompt}\n\nSummary of the conversation so far: ${summary}`;
}

function savedSummary(
  state: TurnChannels,
  priorSummary: string,
): { readonly summary: string; readonly coveredThrough: number } | null {
  if (state.keptFrom === 0 || state.summary.length === 0 || state.summary === priorSummary) return null;
  const coveredThrough = state.lineages
    .slice(0, state.keptFrom)
    .reduce((highest, sequence) => (sequence > highest ? sequence : highest), 0);
  if (coveredThrough === 0) return null;
  return { summary: state.summary, coveredThrough };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }
}

function requireSessionId(value: string): SessionId {
  const parsed = parse(sessionIdSchema, value);
  if (!parsed.ok) throw new SupportTurnRejected("session id is invalid");
  return parsed.value;
}

function requireCustomerText(value: string): string {
  const parsed = customerTextSchema.safeParse(value);
  if (!parsed.success) throw new SupportTurnRejected("customer text is empty");
  return parsed.data;
}

function requireMaxToolRounds(value: number | undefined): number {
  if (value === undefined) return defaultMaxToolRounds;
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    throw new SupportTurnRejected("max tool rounds must be from 1 to 12");
  }
  return value;
}
