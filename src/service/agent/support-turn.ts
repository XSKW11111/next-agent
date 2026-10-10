import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { handoffResultSchema, type HandoffResult } from "../../domain/handoff";
import { parse } from "../../domain/parse";
import {
  sessionIdSchema,
  type Session,
  type SessionId,
  type UnmatchedOrderStreak,
} from "../../domain/session";
import { finalizeSupportAnswer } from "../answer/finalize-support-answer";
import { captureHandoff, type ProposalStore } from "../handoff/handoff";
import { lookupOrder, type OrderCatalog, type OrderStreakStore } from "../order/lookup-order";
import { searchProducts, type ProductSearchDependencies } from "../product/search-products";
import {
  claimEarlyRisers,
  type EarlyRisersCodeStore,
} from "../promotion/claim-early-risers";
import { supportSystemPrompt } from "./prompts/system";
import { runToolRound, type ToolCall, type ToolName } from "../tool-lanes/run-tool-round";

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

const lookupArgsSchema = z.strictObject({
  email: z.string(),
  order_number: z.string().optional(),
});

const claimArgsSchema = z.strictObject({
  request: z.string().trim().min(1),
});

const handoffArgsSchema = z.strictObject({
  contact_email: z.string(),
  reason: z.string(),
  order_number: z.string().optional(),
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
};

export type ScriptedReply = {
  readonly text: string;
  readonly toolCalls?: readonly ModelToolCall[];
};

export type ToolTrace = {
  readonly callId: string;
  readonly tool: ToolName;
};

export type HandoffDraft = HandoffResult["draft"];

export type TurnCompletion = {
  readonly draft: string;
  readonly toolPayloads: readonly unknown[];
  readonly toolTraces: readonly ToolTrace[];
  readonly unmatchedOrderCount: UnmatchedOrderStreak;
  readonly handoffDraft: HandoffDraft | undefined;
};

export type SupportTurnDependencies = {
  readonly orders: {
    readonly catalog: OrderCatalog;
    readonly streaks: OrderStreakStore;
  };
  readonly products: ProductSearchDependencies;
  readonly promotion: {
    readonly session: Session;
    readonly now: Date;
    readonly store: EarlyRisersCodeStore;
    readonly issueCode?: () => string;
  };
  readonly handoff: {
    readonly store: ProposalStore;
    readonly turnId: string;
    readonly proposalId: string;
  };
};

export type SupportTurnInput = {
  readonly model: ScriptedModel;
  readonly sessionId: string;
  readonly customerText: string;
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
  toolPayloads: unknown[];
  toolTraces: ToolTrace[];
  unmatchedOrderCount: UnmatchedOrderStreak;
  heldHandoff: HeldHandoff;
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
});

type ReadyTurn = {
  readonly model: ScriptedModel;
  readonly sessionId: SessionId;
  readonly signal: AbortSignal | undefined;
  readonly maxToolRounds: number;
  readonly productMatchThreshold: number | undefined;
  readonly maxProductCandidates: number | undefined;
  readonly dependencies: SupportTurnDependencies;
};

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
    dependencies: input.dependencies,
  });
  const state = await graph.invoke(
    {
      messages: [{ role: "user", content: customerText }],
      unmatchedOrderCount: streak.streak,
    },
    {
      recursionLimit: maxToolRounds * 2 + 1,
      signal: input.signal,
      configurable: { thread_id: sessionId },
    },
  );

  return {
    draft: finalizeSupportAnswer({
      draft: state.draft,
      toolPayloads: state.toolPayloads,
    }),
    toolPayloads: state.toolPayloads,
    toolTraces: state.toolTraces,
    unmatchedOrderCount: state.unmatchedOrderCount,
    handoffDraft: heldDraft(state.heldHandoff),
  };
}

function compileSupportGraph(ready: ReadyTurn) {
  return new StateGraph(TurnState)
    .addNode("agent", (state: TurnChannels) => agentNode(state, ready))
    .addNode("tools", (state: TurnChannels) => toolsNode(state, ready))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state: TurnChannels) => routeAfterAgent(state, ready), [
      "tools",
      END,
    ])
    .addConditionalEdges("tools", (state: TurnChannels) => routeAfterTools(state, ready), [
      "agent",
      END,
    ])
    .compile();
}

async function agentNode(state: TurnChannels, ready: ReadyTurn): Promise<Partial<TurnChannels>> {
  throwIfAborted(ready.signal);
  const reply = await ready.model.complete({
    systemPrompt: supportSystemPrompt,
    messages: state.messages,
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
    toolRounds: state.toolRounds + 1,
  };
}

function routeAfterAgent(state: TurnChannels, ready: ReadyTurn): "tools" | typeof END {
  const latest = state.messages.at(-1);
  if (latest?.role !== "assistant" || latest.toolCalls.length === 0) return END;
  if (state.toolRounds > ready.maxToolRounds) return END;
  return "tools";
}

async function toolsNode(state: TurnChannels, ready: ReadyTurn): Promise<Partial<TurnChannels>> {
  throwIfAborted(ready.signal);
  const latest = state.messages.at(-1);
  if (latest?.role !== "assistant") {
    throw new SupportTurnRejected("tools node has no assistant reply");
  }

  const calls: ToolCall<unknown>[] = latest.toolCalls.map((call) => ({
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
    messages: latest.toolCalls.map((call, index) => {
      const payload = round.results[index];
      if (payload === undefined) throw new SupportTurnRejected("tool result is missing");
      return {
        role: "tool" as const,
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(payload),
      };
    }),
    toolPayloads: [...round.results],
    toolTraces: latest.toolCalls.map((call) => ({ callId: call.id, tool: call.name })),
    unmatchedOrderCount: latestUnmatched(round.results, state.unmatchedOrderCount),
    heldHandoff: firstHandoff(round.results),
  };
}

function routeAfterTools(state: TurnChannels, ready: ReadyTurn): "agent" | typeof END {
  if (state.toolRounds >= ready.maxToolRounds) return END;
  return "agent";
}

async function runCall(call: ModelToolCall, ready: ReadyTurn): Promise<unknown> {
  throwIfAborted(ready.signal);
  try {
    return await runNamedTool(call, ready);
  } catch (error) {
    if (ready.signal?.aborted) throw error;
    return unavailable(call.name);
  }
}

async function runNamedTool(call: ModelToolCall, ready: ReadyTurn): Promise<unknown> {
  switch (call.name) {
    case "lookup_order":
      return runLookup(call.args, ready);
    case "search_products":
      return searchProducts(call.args, ready.dependencies.products, {
        ...(ready.productMatchThreshold === undefined
          ? {}
          : { threshold: ready.productMatchThreshold }),
        ...(ready.maxProductCandidates === undefined
          ? {}
          : { candidateLimit: ready.maxProductCandidates }),
      });
    case "claim_early_risers":
      return runClaim(call.args, ready);
    case "capture_handoff":
      return runCapture(call.args, ready);
    default: {
      const unexpected: never = call.name;
      return unexpected;
    }
  }
}

async function runLookup(args: unknown, ready: ReadyTurn): Promise<unknown> {
  const parsed = lookupArgsSchema.safeParse(args);
  if (!parsed.success) return unavailable("lookup_order");
  return lookupOrder(ready.dependencies.orders.catalog, ready.dependencies.orders.streaks, {
    sessionId: ready.sessionId,
    email: parsed.data.email,
    ...(parsed.data.order_number === undefined ? {} : { orderNumber: parsed.data.order_number }),
  });
}

async function runClaim(args: unknown, ready: ReadyTurn): Promise<unknown> {
  const parsed = claimArgsSchema.safeParse(args);
  if (!parsed.success) return unavailable("claim_early_risers");
  const promotion = ready.dependencies.promotion;
  return claimEarlyRisers({
    session: promotion.session,
    now: promotion.now,
    store: promotion.store,
    ...(promotion.issueCode === undefined ? {} : { issueCode: promotion.issueCode }),
  });
}

function runCapture(args: unknown, ready: ReadyTurn): unknown {
  const parsed = handoffArgsSchema.safeParse(args);
  if (!parsed.success) return unavailable("capture_handoff");
  const captured = captureHandoff(ready.dependencies.handoff.store, {
    proposalId: ready.dependencies.handoff.proposalId,
    sessionId: ready.sessionId,
    turnId: ready.dependencies.handoff.turnId,
    contactEmail: parsed.data.contact_email,
    reason: parsed.data.reason,
    ...(parsed.data.order_number === undefined ? {} : { orderNumber: parsed.data.order_number }),
  });
  if (!captured.ok) return unavailable("capture_handoff");
  return captured.value;
}

function unavailable(tool: ToolName): { readonly kind: "service_unavailable"; readonly tool: ToolName } {
  return { kind: "service_unavailable", tool };
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
