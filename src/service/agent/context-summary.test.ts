import { expect, test } from "vitest";
import { compactHistory, ContextSummaryRejected, type CompactMessage } from "./context-summary";

const byLength = (text: string) => text.length;

test("a transcript under 70 percent stays raw and does not call the summarizer", async () => {
  let calls = 0;
  const result = await compactHistory({
    systemPrompt: "sys",
    messages: [message("1", "user", "short question")],
    runningSummary: null,
    windowTokens: 100,
    startRatio: 0.7,
    summaryReserveTokens: 20,
    tokenCounter: byLength,
    summarize: async () => {
      calls += 1;
      return "should not run";
    },
  });

  expect(calls).toBe(0);
  expect(result).toEqual({ kind: "unchanged", summary: null, keptFrom: 0 });
});

test("overflow from the oldest is summarized once and the newest user message stays raw", async () => {
  const seen: string[] = [];
  const messages: CompactMessage[] = [
    message("old-user", "user", "a".repeat(40)),
    message("old-assistant", "assistant", "b".repeat(40)),
    message("current", "user", "c".repeat(40)),
  ];

  const result = await compactHistory({
    systemPrompt: "sys",
    messages,
    runningSummary: null,
    windowTokens: 100,
    startRatio: 0.7,
    summaryReserveTokens: 20,
    tokenCounter: byLength,
    summarize: async (prompt) => {
      seen.push(prompt);
      return "SUM";
    },
  });

  expect(seen).toHaveLength(1);
  expect(seen[0]).toContain("a".repeat(40));
  expect(seen[0]).toContain("b".repeat(40));
  expect(seen[0]).not.toContain("c".repeat(40));
  expect(result.keptFrom).toBe(2);
  expect(result.kind).toBe("summarized");
  expect(result.summary).toEqual({
    summary: "SUM",
    summarizedIds: ["old-user", "old-assistant"],
  });
});

test("a later pass does not send ids that were already summarized", async () => {
  let calls = 0;
  const result = await compactHistory({
    systemPrompt: "sys",
    messages: [
      message("old-user", "user", "a".repeat(40)),
      message("current", "user", "c".repeat(20)),
    ],
    runningSummary: { summary: "SUM", summarizedIds: ["old-user"] },
    windowTokens: 100,
    startRatio: 0.7,
    summaryReserveTokens: 20,
    tokenCounter: byLength,
    summarize: async () => {
      calls += 1;
      return "AGAIN";
    },
  });

  expect(calls).toBe(0);
  expect(result.summary?.summary).toBe("SUM");
  expect(result.keptFrom).toBe(1);
});

test("an oversized summary falls back to bounded raw history without persisting it", async () => {
  const result = await compactHistory({
    systemPrompt: "sys",
    messages: [
      message("old", "user", "a".repeat(40)),
      message("current", "user", "c".repeat(40)),
    ],
    runningSummary: null,
    windowTokens: 100,
    startRatio: 0.7,
    summaryReserveTokens: 5,
    hardTokens: 75,
    tokenCounter: byLength,
    summarize: async () => "too long summary",
  });

  expect(result).toEqual({ kind: "raw_fallback", summary: null, keptFrom: 1 });
});

test("a failed summarizer keeps the current user message within the hard cap", async () => {
  const result = await compactHistory({
    systemPrompt: "sys",
    messages: [message("old", "user", "a".repeat(40)), message("current", "user", "c".repeat(40))],
    runningSummary: null,
    windowTokens: 100,
    hardTokens: 75,
    startRatio: 0.7,
    tokenCounter: byLength,
    summarize: async () => { throw new Error("provider unavailable"); },
  });

  expect(result).toEqual({ kind: "raw_fallback", summary: null, keptFrom: 1 });
});

test("an existing summary that no longer fits is omitted for this turn", async () => {
  const result = await compactHistory({
    systemPrompt: "sys",
    messages: [message("current", "user", "current")],
    runningSummary: { summary: "a".repeat(90), summarizedIds: ["old"] },
    windowTokens: 100,
    hardTokens: 100,
    tokenCounter: byLength,
    summarize: async () => "unused",
  });

  expect(result).toEqual({ kind: "raw_fallback", summary: null, keptFrom: 0 });
});

test("the current user message is not summarized when it alone exceeds the raw budget", async () => {
  let calls = 0;
  const result = await compactHistory({
    systemPrompt: "sys",
    messages: [message("current", "user", "c".repeat(80))],
    runningSummary: null,
    windowTokens: 100,
    startRatio: 0.7,
    summaryReserveTokens: 20,
    tokenCounter: byLength,
    summarize: async () => {
      calls += 1;
      return "SUM";
    },
  });

  expect(calls).toBe(0);
  expect(result).toEqual({ kind: "raw_fallback", summary: null, keptFrom: 0 });
});

test("protected system and current user content over the hard cap rejects", async () => {
  await expect(compactHistory({
    systemPrompt: "sys",
    messages: [message("current", "user", "c".repeat(80))],
    runningSummary: null,
    windowTokens: 100,
    hardTokens: 70,
    tokenCounter: byLength,
    summarize: async () => "SUM",
  })).rejects.toBeInstanceOf(ContextSummaryRejected);
});

function message(id: string, role: CompactMessage["role"], content: string): CompactMessage {
  return { id, role, content };
}
