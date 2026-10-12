import { describe, expect, test } from "vitest";
import { sendAllowed } from "./send-allowed";

describe("sendAllowed", () => {
  test("a new chat can send before any history load", () => {
    expect(
      sendAllowed({
        failed: false,
        restoreHistory: false,
        historyReady: false,
        status: "ready",
      }),
    ).toBe(true);
  });

  test("a restored chat waits until history is ready", () => {
    expect(
      sendAllowed({
        failed: false,
        restoreHistory: true,
        historyReady: false,
        status: "ready",
      }),
    ).toBe(false);
    expect(
      sendAllowed({
        failed: false,
        restoreHistory: true,
        historyReady: true,
        status: "ready",
      }),
    ).toBe(true);
  });

  test("a failed start and an in-flight reply stay blocked", () => {
    expect(
      sendAllowed({
        failed: true,
        restoreHistory: false,
        historyReady: true,
        status: "ready",
      }),
    ).toBe(false);
    expect(
      sendAllowed({
        failed: false,
        restoreHistory: false,
        historyReady: true,
        status: "submitted",
      }),
    ).toBe(false);
    expect(
      sendAllowed({
        failed: false,
        restoreHistory: false,
        historyReady: true,
        status: "streaming",
      }),
    ).toBe(false);
  });
});
