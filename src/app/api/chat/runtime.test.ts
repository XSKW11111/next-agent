import { expect, test } from "vitest";
import { currentChatRuntime } from "./runtime";

test("currentChatRuntime builds from the process env when nothing was installed", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    expect(() => currentChatRuntime()).toThrow("agent config is invalid: OPENROUTER_API_KEY");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});
