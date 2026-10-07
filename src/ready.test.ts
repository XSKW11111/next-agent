import { expect, test } from "vitest";
import { isReady } from "./ready";

test("isReady returns true", () => {
  expect(isReady()).toBe(true);
});
