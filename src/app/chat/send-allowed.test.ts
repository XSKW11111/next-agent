import { describe, expect, test } from "vitest";
import { sendAllowed } from "./send-allowed";

describe("sendAllowed", () => {
  test("empty text cannot be sent", () => {
    expect(sendAllowed({ text: "", status: "ready" })).toBe(false);
  });

  test("whitespace cannot be sent", () => {
    expect(sendAllowed({ text: " \n\t ", status: "ready" })).toBe(false);
  });

  test("non-empty text can be sent while ready", () => {
    expect(sendAllowed({ text: "where is my order", status: "ready" })).toBe(true);
  });

  test("non-empty text cannot be sent while submitted", () => {
    expect(sendAllowed({ text: "where is my order", status: "submitted" })).toBe(false);
  });

  test("non-empty text cannot be sent while streaming", () => {
    expect(sendAllowed({ text: "where is my order", status: "streaming" })).toBe(false);
  });
});
