import { z } from "zod";
import { parse, type Parsed } from "./parse";

const timezoneName = z.string().trim().min(1);

const earlyRisersCode = z.string().regex(/^EARLY-[A-Za-z0-9]{8}$/);

const promotionEligibleSchema = z.strictObject({
  kind: z.literal("promotion_eligible"),
  campaign: z.literal("Early Risers"),
  code: earlyRisersCode,
  discountPercent: z.literal(10),
  validOn: z.iso.date(),
  expiresAt: z.iso.datetime({ offset: true }),
  timezone: timezoneName,
});

const promotionIneligibleSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    kind: z.literal("promotion_ineligible"),
    reason: z.literal("outside_window"),
    timezone: timezoneName,
    window: z.literal("08:00-10:00"),
  }),
  z.strictObject({
    kind: z.literal("promotion_ineligible"),
    reason: z.literal("timezone_unresolved"),
  }),
]);

const promotionUnavailableSchema = z.strictObject({
  kind: z.literal("service_unavailable"),
  tool: z.literal("claim_early_risers"),
});

export const promotionResultSchema = z.union([
  promotionEligibleSchema,
  promotionIneligibleSchema,
  promotionUnavailableSchema,
]);

export type PromotionResult = z.infer<typeof promotionResultSchema>;

export function parsePromotionResult(input: unknown): Parsed<PromotionResult> {
  return parse(promotionResultSchema, input);
}
