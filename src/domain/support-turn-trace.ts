/** Mirrors tool names on the support turn — kept in domain so traces do not import services. */
export type SupportTurnTraceToolName =
  | "lookup_order"
  | "search_products"
  | "claim_early_risers"
  | "capture_handoff";

/** Spec trace input — no secrets, no in-flight siblings. */
export type SupportTurnTraceTimezone =
  | { readonly kind: "unresolved" }
  | { readonly kind: "resolved"; readonly name: string };

export type SupportTurnTracePriorTurn = {
  readonly customer: string;
  readonly assistant: string;
};

export type SupportTurnTraceInput = {
  readonly systemPrompt: string;
  readonly priorTurns: readonly SupportTurnTracePriorTurn[];
  readonly currentSentence: string;
  /** Present only when this turn persisted a summary row. */
  readonly summaryText: string | null;
  readonly timezone: SupportTurnTraceTimezone;
};

export type SupportTurnTraceToolResult = {
  readonly callId: string;
  readonly tool: SupportTurnTraceToolName;
  readonly payload: unknown;
};

export type SupportTurnTraceChunkPlan = {
  readonly chunkIndex: number;
  readonly calls: readonly {
    readonly callId: string;
    readonly tool: SupportTurnTraceToolName;
    readonly kind: "read" | "write";
  }[];
  readonly parallelReadCallIds: readonly string[];
  readonly writeOrderCallIds: readonly string[];
};

export type SupportTurnTraceOutput = {
  readonly assistantLine: string;
  readonly toolResults: readonly SupportTurnTraceToolResult[];
  readonly waitingCalls: readonly {
    readonly callId: string;
    readonly tool: SupportTurnTraceToolName;
  }[];
  readonly chunkPlans: readonly SupportTurnTraceChunkPlan[];
};

/** Domain-readable seam for tests and eval — no LangSmith types. */
export type SupportTurnTraceView = {
  readonly traceId: string;
  readonly input: SupportTurnTraceInput;
  readonly output: SupportTurnTraceOutput;
  readonly stepTimingsMs: Readonly<Record<string, number>>;
  readonly modelFailure: { readonly message: string } | null;
};
