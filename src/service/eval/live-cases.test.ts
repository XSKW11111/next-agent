import { expect, test } from "vitest";
import { outageSentence } from "../answer/finalize-support-answer";
import { langsmithTraceUrl, runLiveCases, scoredLiveCases, type LiveAskResult } from "./live-cases";

const explanation = "Early Risers is 10% off from 08:00-10:00 local time.";

test("five canned trials score reply-visible and trace-backed cases with no skips", async () => {
  const report = await runLiveCases(async (context) => cannedAsk(context.id, context.turns, context.variant));

  const found = report.find((item) => item.id === "order-found");
  const inside = report.find((item) => item.id === "early-risers-inside");
  const outside = report.find((item) => item.id === "early-risers-outside");
  const missed = report.find((item) => item.id === "order-miss");
  const outage = report.find((item) => item.id === "order-outage");
  const emails = report.find((item) => item.id === "email-orders");
  const shortInside = report.find(
    (item) => item.id === "early-risers-short-accept" && item.variant === "inside",
  );
  const shortUnresolved = report.find(
    (item) => item.id === "early-risers-short-accept" && item.variant === "unresolved",
  );

  expect(found).toMatchObject({ trials: 5, passed: 5, passAt1: 1, passAt3: 1, passAll1: 1 });
  expect(inside).toMatchObject({ trials: 5, passed: 5, passAt1: 1, passAll1: 1 });
  expect(outside).toMatchObject({ trials: 5, passed: 0, passAt1: 0, passAll1: 0 });
  expect(missed).toMatchObject({ trials: 5, passed: 5, passAt1: 1 });
  expect(outage).toMatchObject({ trials: 5, passed: 5, passAt1: 1 });
  expect(emails).toMatchObject({ trials: 5, passed: 5, passAt1: 1 });
  expect(shortInside).toMatchObject({ trials: 5, passed: 5, passAt1: 1 });
  expect(shortUnresolved).toMatchObject({ trials: 5, passed: 5, passAt1: 1 });
  expect(missed && "skipped" in missed).toBe(false);
  expect(scoredLiveCases.filter((item) => item.id === "early-risers-short-accept")).toHaveLength(3);
  expect(found?.trialTraces).toHaveLength(5);
  expect(found?.trialTraces[0]).toEqual({
    traceId: "trace-order-found",
    traceUrl: langsmithTraceUrl("unit", "trace-order-found"),
  });
});

test("short-accept inside fails when the second trace omits the explanation", async () => {
  const report = await runLiveCases(async (context) => {
    if (context.id !== "early-risers-short-accept" || context.variant !== "inside") {
      return cannedAsk(context.id, context.turns, context.variant);
    }
    return {
      replies: [explanation, "Your code is EARLY-OK."],
      traces: [
        emptyTrace("t1"),
        {
          ...emptyTrace("t2"),
          priorCustomerSentence: "What discounts do you offer?",
          priorAssistantSentence: "Here are our products.",
        },
      ],
    };
  });

  const shortInside = report.find(
    (item) => item.id === "early-risers-short-accept" && item.variant === "inside",
  );
  expect(shortInside).toMatchObject({ trials: 5, passed: 0, passAt1: 0 });
});

function cannedAsk(
  id: string,
  turns: readonly string[],
  variant: string | undefined,
): LiveAskResult {
  switch (id) {
    case "order-found":
      return {
        replies: ["Your order #W002 shipped. Track it at https://track.example/TRK987654321"],
        traces: [emptyTrace("trace-order-found")],
      };
    case "snow-recommend":
      return {
        replies: ["Summit Pro X Skis are in stock."],
        traces: [emptyTrace("trace-snow")],
      };
    case "early-risers-inside":
      return {
        replies: ["Your code is EARLY-SAME.", "Your code is EARLY-SAME."],
        traces: [emptyTrace("t1"), emptyTrace("t2")],
      };
    case "early-risers-outside":
      return {
        replies: ["Your code is EARLY-BAD."],
        traces: [emptyTrace("t1")],
      };
    case "early-risers-explain":
      return {
        replies: ["Early Risers is a morning discount."],
        traces: [emptyTrace("t1")],
      };
    case "handoff-propose":
      return {
        replies: ["Please choose Confirm or Cancel."],
        traces: [emptyTrace("t1")],
      };
    case "order-miss":
      return {
        replies: ["No order matches that number. Another order is ***02."],
        traces: [
          {
            ...emptyTrace("trace-miss"),
            lookupResult: { kind: "order_not_found" },
          },
        ],
      };
    case "order-outage":
      return {
        replies: [outageSentence],
        traces: [emptyTrace("trace-outage")],
      };
    case "email-orders":
      return {
        replies: ["#W002 is in-transit and #W003 is processing."],
        traces: [
          {
            ...emptyTrace("trace-email"),
            orders: [
              { orderNumber: "#W002", status: "in-transit" },
              { orderNumber: "#W003", status: "processing" },
            ],
          },
        ],
      };
    case "early-risers-short-accept":
      return shortAcceptCanned(variant);
    default:
      throw new Error(`missing canned reply for ${id} (${turns.join(" | ")})`);
  }
}

function shortAcceptCanned(variant: string | undefined): LiveAskResult {
  const prior = {
    priorCustomerSentence: "What discounts do you offer?",
    priorAssistantSentence: explanation,
  };
  switch (variant) {
    case "inside":
      return {
        replies: [explanation, "Your code is EARLY-OK."],
        traces: [emptyTrace("s1"), { ...emptyTrace("s2"), ...prior }],
      };
    case "outside":
      return {
        replies: [explanation, "Early Risers is available 08:00-10:00 local time."],
        traces: [emptyTrace("s1"), { ...emptyTrace("s2"), ...prior }],
      };
    case "unresolved":
      return {
        replies: [explanation, "Early Risers needs a local timezone before a code can issue."],
        traces: [emptyTrace("s1"), { ...emptyTrace("s2"), ...prior }],
      };
    default:
      throw new Error(`missing short-accept variant ${variant}`);
  }
}

function emptyTrace(traceId: string) {
  return {
    traceId,
    traceUrl: langsmithTraceUrl("unit", traceId),
  };
}
