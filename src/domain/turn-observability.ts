import type { SupportTurnTraceView } from "./support-turn-trace";

/** One saved send: latency always, full domain trace when tracing ran. */
export type TurnObservabilityRecord = {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly savedAt: string;
  readonly currentSentence: string;
  readonly reply: string;
  readonly serverLatencyMs: number;
  readonly stepTimingsMs: Readonly<Record<string, number>>;
  readonly trace: SupportTurnTraceView | null;
  readonly sink: "local" | "langsmith+local";
};

export type TurnObservabilitySummary = {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly savedAt: string;
  readonly currentSentence: string;
  readonly reply: string;
  readonly serverLatencyMs: number;
  readonly hasTrace: boolean;
  readonly sink: TurnObservabilityRecord["sink"];
};
