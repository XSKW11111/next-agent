import { expect, test } from "vitest";
import { parseSession, personOffer } from "./session";

const sessionId = "11111111-1111-4111-8111-111111111111";

test("parseSession accepts a session whose streak can offer a person", () => {
  expect(
    parseSession({
      id: sessionId,
      localTimezone: { kind: "resolved", name: " America/Chicago " },
      unmatchedOrderStreak: 2,
    }),
  ).toEqual({
    ok: true,
    value: {
      id: sessionId,
      localTimezone: { kind: "resolved", name: "America/Chicago" },
      unmatchedOrderStreak: 2,
    },
  });
  expect(personOffer(2)).toEqual({ kind: "person_offer" });
  expect(personOffer(1)).toEqual({ kind: "no_person_offer" });
});

test("parseSession accepts an unresolved timezone", () => {
  expect(
    parseSession({
      id: sessionId,
      localTimezone: { kind: "unresolved" },
      unmatchedOrderStreak: 0,
    }),
  ).toEqual({
    ok: true,
    value: {
      id: sessionId,
      localTimezone: { kind: "unresolved" },
      unmatchedOrderStreak: 0,
    },
  });
  expect(personOffer(0)).toEqual({ kind: "no_person_offer" });
});

test("parseSession rejects an email used as the customer", () => {
  expect(
    parseSession({
      id: sessionId,
      email: "ada@example.com",
      localTimezone: { kind: "unresolved" },
      unmatchedOrderStreak: 0,
    }),
  ).toEqual({ ok: false });
});

test("parseSession rejects a streak of three", () => {
  expect(
    parseSession({
      id: sessionId,
      localTimezone: { kind: "unresolved" },
      unmatchedOrderStreak: 3,
    }),
  ).toEqual({ ok: false });
});
