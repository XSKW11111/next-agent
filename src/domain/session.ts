import { z } from "zod";
import { brand, parse, type Parsed } from "./parse";

export const sessionIdSchema = z.uuid().transform(brand<"SessionId">);

export type SessionId = z.infer<typeof sessionIdSchema>;

export const localTimezoneSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("resolved"),
    name: z.string().trim().min(1),
  }),
  z.strictObject({
    kind: z.literal("unresolved"),
  }),
]);

export type LocalTimezone = z.infer<typeof localTimezoneSchema>;

export const unmatchedOrderStreakSchema = z.literal([0, 1, 2]);

export type UnmatchedOrderStreak = z.infer<typeof unmatchedOrderStreakSchema>;

export const sessionSchema = z.strictObject({
  id: sessionIdSchema,
  localTimezone: localTimezoneSchema,
  unmatchedOrderStreak: unmatchedOrderStreakSchema,
});

export type Session = z.infer<typeof sessionSchema>;

export type PersonOffer =
  | { readonly kind: "person_offer" }
  | { readonly kind: "no_person_offer" };

export function personOffer(streak: UnmatchedOrderStreak): PersonOffer {
  switch (streak) {
    case 0:
    case 1:
      return { kind: "no_person_offer" };
    case 2:
      return { kind: "person_offer" };
    default: {
      const exhaustive: never = streak;
      return exhaustive;
    }
  }
}

export function parseSession(input: unknown): Parsed<Session> {
  return parse(sessionSchema, input);
}
