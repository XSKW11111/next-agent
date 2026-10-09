import { expect, test } from "vitest";
import { parseTurn } from "./turn";

test("parseTurn accepts one customer send", () => {
  expect(
    parseTurn({
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
      text: "  where is my order  ",
    }),
  ).toEqual({
    ok: true,
    value: {
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
      text: "where is my order",
    },
  });
});

test("parseTurn rejects an empty send", () => {
  expect(
    parseTurn({
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
      text: "   ",
    }),
  ).toEqual({ ok: false });
});
