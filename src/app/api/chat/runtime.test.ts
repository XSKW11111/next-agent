import { expect, test } from "vitest";
import { currentChatRuntime } from "./runtime";

test("currentChatRuntime throws when nothing was installed", () => {
  expect(() => currentChatRuntime()).toThrow("chat runtime is not installed");
});
