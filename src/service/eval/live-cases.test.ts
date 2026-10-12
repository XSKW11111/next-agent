import { expect, test } from "vitest";
import { runLiveCases, scoredLiveCases } from "./live-cases";

const canned: Record<string, readonly string[]> = {
  "My email is jane.smith@example.com. Where is order #W002?": [
    "Your order #W002 shipped. Track it at https://track.example/TRK987654321",
  ],
  "What skis do you recommend for snow?": ["Summit Pro X Skis are in stock."],
  "I want to claim the Early Risers discount.": [
    "Your code is EARLY-SAME.",
    "Early Risers is 10% off from 08:00-10:00 local time.",
  ],
  "What discounts do you offer?": ["Early Risers is a morning discount."],
  "I want a person to help me. Contact me at person@example.com. The reason is the shipment needs a person.":
    ["Please choose Confirm or Cancel."],
};

test("five canned trials score the reply-visible cases", async () => {
  const report = await runLiveCases(async (turns) => {
    const first = turns[0] ?? "";
    const replies = canned[first];
    if (replies === undefined) throw new Error("missing canned reply");
    if (turns.length === 2) return [replies[0] ?? "", replies[0] ?? ""];
    return [replies[0] ?? replies[1] ?? ""];
  });

  const found = report.find((item) => item.id === "order-found");
  const inside = report.find((item) => item.id === "early-risers-inside");
  const outside = report.find((item) => item.id === "early-risers-outside");
  const missed = report.find((item) => item.id === "order-miss");

  expect(found).toMatchObject({ trials: 5, passed: 5, passAt1: 1, passAt3: 1, passAll1: 1 });
  expect(inside).toMatchObject({ trials: 5, passed: 5, passAt1: 1, passAll1: 1 });
  expect(outside).toMatchObject({ trials: 5, passed: 0, passAt1: 0, passAll1: 0 });
  expect(missed).toEqual({
    id: "order-miss",
    skipped: "The chat reply does not include the tool name, so a miss cannot be scored from the text.",
  });
  expect(scoredLiveCases).toHaveLength(6);
});
