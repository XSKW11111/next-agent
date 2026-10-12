import { expect, test } from "vitest";
import { outageSentence } from "../answer/finalize-support-answer";
import { gradeCase, scoreCaseTrials } from "./grade-case";

const shipped =
  "Your order #W002 shipped. Track it at https://track.example/TRK987654321";

test("order-found requires the order, a shipped status, and a tracking link", () => {
  expect(gradeCase("order-found", { reply: shipped })).toBe(true);
  expect(gradeCase("order-found", { reply: "Your order #W002 is in transit." })).toBe(false);
});

test("snow-recommend names the skis and leaves out catalog attributes", () => {
  expect(gradeCase("snow-recommend", { reply: "Summit Pro X Skis are in stock." })).toBe(true);
  expect(
    gradeCase("snow-recommend", { reply: "Summit Pro X Skis cost $200 in size M." }),
  ).toBe(false);
});

test("early-risers-inside requires the same code on both claims", () => {
  expect(
    gradeCase("early-risers-inside", {
      reply: "Your code is EARLY-SAME.",
      secondReply: "The same code is EARLY-SAME.",
    }),
  ).toBe(true);
  expect(
    gradeCase("early-risers-inside", {
      reply: "Your code is EARLY-ONE.",
      secondReply: "Your code is EARLY-TWO.",
    }),
  ).toBe(false);
});

test("early-risers-outside explains the window and issues no code", () => {
  expect(
    gradeCase("early-risers-outside", {
      reply: "Early Risers is 10% off from 08:00-10:00 local time.",
    }),
  ).toBe(true);
  expect(
    gradeCase("early-risers-outside", {
      reply: "Your code is EARLY-OUT and the window is 08:00-10:00.",
    }),
  ).toBe(false);
});

test("early-risers-explain names the promotion and issues no code", () => {
  expect(
    gradeCase("early-risers-explain", {
      reply: "Early Risers is a morning discount.",
    }),
  ).toBe(true);
  expect(gradeCase("early-risers-explain", { reply: "Use EARLY-ASK." })).toBe(false);
});

test("handoff-propose offers Confirm and Cancel and no case id", () => {
  expect(
    gradeCase("handoff-propose", {
      reply: "Please choose Confirm or Cancel.",
    }),
  ).toBe(true);
  expect(
    gradeCase("handoff-propose", {
      reply: "Confirm case 40ec6a42-6285-4d81-bea6-fd7c9fb00c10 or Cancel.",
    }),
  ).toBe(false);
});

test("order-miss requires the lookup, masks other orders, and is not the outage sentence", () => {
  expect(
    gradeCase("order-miss", {
      reply: "No order matches that number. Another order is ***02.",
      toolNames: ["lookup_order"],
      requestedOrder: "#W999",
    }),
  ).toBe(true);
  expect(
    gradeCase("order-miss", {
      reply: "I also see #W002.",
      toolNames: ["lookup_order"],
      requestedOrder: "#W999",
    }),
  ).toBe(false);
  expect(gradeCase("order-miss", { reply: outageSentence, toolNames: ["lookup_order"] })).toBe(
    false,
  );
});

test("order-outage is only the outage sentence", () => {
  expect(gradeCase("order-outage", { reply: outageSentence })).toBe(true);
  expect(gradeCase("order-outage", { reply: `${outageSentence} Try again.` })).toBe(false);
});

test("email-orders names both orders and both statuses", () => {
  expect(
    gradeCase("email-orders", {
      reply: "#W002 is in-transit and #W003 is processing.",
      orders: [
        { orderNumber: "#W002", status: "in-transit" },
        { orderNumber: "#W003", status: "processing" },
      ],
    }),
  ).toBe(true);
  expect(
    gradeCase("email-orders", {
      reply: "#W002 is in-transit.",
      orders: [
        { orderNumber: "#W002", status: "in-transit" },
        { orderNumber: "#W003", status: "processing" },
      ],
    }),
  ).toBe(false);
});

test("five trial results score pass@1, pass@3, and pass^1", () => {
  expect(scoreCaseTrials([true, false, false, false, false])).toEqual({
    trials: 5,
    passed: 1,
    passAt1: 0.2,
    passAt3: 0.6,
    passAll1: 0.2,
    passAll3: 0,
  });
  expect(scoreCaseTrials([true, true, true, true, true]).passAt1).toBe(1);
});
