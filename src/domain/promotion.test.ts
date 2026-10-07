import { expect, test } from "vitest";
import { parsePromotionResult } from "./promotion";

test("parsePromotionResult accepts an Early Risers code", () => {
  expect(
    parsePromotionResult({
      kind: "promotion_eligible",
      campaign: "Early Risers",
      code: "EARLY-ABCD1234",
      discountPercent: 10,
      validOn: "2026-10-08",
      expiresAt: "2026-10-09T00:00:00-05:00",
      timezone: " America/Chicago ",
    }),
  ).toEqual({
    ok: true,
    value: {
      kind: "promotion_eligible",
      campaign: "Early Risers",
      code: "EARLY-ABCD1234",
      discountPercent: 10,
      validOn: "2026-10-08",
      expiresAt: "2026-10-09T00:00:00-05:00",
      timezone: "America/Chicago",
    },
  });
});

test("parsePromotionResult keeps timezone off an unresolved claim and on a window miss", () => {
  expect(
    parsePromotionResult({
      kind: "promotion_ineligible",
      reason: "outside_window",
      timezone: " America/Chicago ",
      window: "08:00-10:00",
    }),
  ).toEqual({
    ok: true,
    value: {
      kind: "promotion_ineligible",
      reason: "outside_window",
      timezone: "America/Chicago",
      window: "08:00-10:00",
    },
  });
  expect(
    parsePromotionResult({
      kind: "promotion_ineligible",
      reason: "timezone_unresolved",
    }),
  ).toEqual({
    ok: true,
    value: { kind: "promotion_ineligible", reason: "timezone_unresolved" },
  });
  expect(
    parsePromotionResult({
      kind: "promotion_ineligible",
      reason: "timezone_unresolved",
      timezone: "America/Chicago",
      window: "08:00-10:00",
    }),
  ).toEqual({ ok: false });
  expect(
    parsePromotionResult({ kind: "service_unavailable", tool: "claim_early_risers" }),
  ).toEqual({
    ok: true,
    value: { kind: "service_unavailable", tool: "claim_early_risers" },
  });
});

test("parsePromotionResult rejects an ineligible reason outside the two allowed", () => {
  expect(
    parsePromotionResult({
      kind: "promotion_ineligible",
      reason: "expired",
      timezone: "America/Chicago",
      window: "08:00-10:00",
    }),
  ).toEqual({ ok: false });
});
