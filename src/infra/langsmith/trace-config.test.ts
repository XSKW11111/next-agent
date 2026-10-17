import { describe, expect, test } from "vitest";
import { parseLangSmithTraceConfig, parseTerminalObservability } from "./trace-config";

describe("parseLangSmithTraceConfig", () => {
  test("requires both LangSmith settings even when the old debug flag is off", () => {
    expect(parseLangSmithTraceConfig({ NEXT_AGENT_DEBUG_TRACE: "false" })).toEqual({
      ok: false,
      names: ["LANGSMITH_API_KEY", "LANGSMITH_PROJECT"],
    });
  });

  test("reads the required LangSmith settings", () => {
    expect(parseLangSmithTraceConfig({
      LANGSMITH_API_KEY: " ls-key ",
      LANGSMITH_PROJECT: " next-agent ",
    })).toEqual({ ok: true, value: { apiKey: "ls-key", project: "next-agent" } });
  });
});

describe("parseTerminalObservability", () => {
  test("defaults off and only accepts true or false", () => {
    expect(parseTerminalObservability({})).toEqual({ ok: true, value: false });
    expect(parseTerminalObservability({ NEXT_AGENT_TERMINAL_OBSERVABILITY: "true" })).toEqual({ ok: true, value: true });
    expect(parseTerminalObservability({ NEXT_AGENT_TERMINAL_OBSERVABILITY: "1" })).toEqual({
      ok: false,
      names: ["NEXT_AGENT_TERMINAL_OBSERVABILITY"],
    });
  });

  test("production never emits terminal observations", () => {
    expect(parseTerminalObservability({ VERCEL_ENV: "production", NEXT_AGENT_TERMINAL_OBSERVABILITY: "true" })).toEqual({
      ok: true,
      value: false,
    });
    expect(parseTerminalObservability({ NODE_ENV: "production", NEXT_AGENT_TERMINAL_OBSERVABILITY: "true" })).toEqual({
      ok: true,
      value: false,
    });
  });
});
