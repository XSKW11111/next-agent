import { describe, expect, test } from "vitest";
import { parseDebugTraceConfig, traceConfigDisabled } from "./debug-trace-config";

describe("parseDebugTraceConfig", () => {
  test("treats a missing flag as tracing off", () => {
    expect(parseDebugTraceConfig({})).toEqual({
      ok: true,
      value: traceConfigDisabled(),
    });
  });

  test("treats false as tracing off without requiring LangSmith keys", () => {
    expect(
      parseDebugTraceConfig({
        NEXT_AGENT_DEBUG_TRACE: "false",
        LANGSMITH_API_KEY: "",
      }),
    ).toEqual({ ok: true, value: traceConfigDisabled() });
  });

  test("requires the project and key when tracing is on", () => {
    expect(parseDebugTraceConfig({ NEXT_AGENT_DEBUG_TRACE: "true" })).toEqual({
      ok: false,
      names: ["LANGSMITH_API_KEY", "LANGSMITH_PROJECT"],
    });
  });

  test("reads the LangSmith settings when tracing is on", () => {
    expect(
      parseDebugTraceConfig({
        NEXT_AGENT_DEBUG_TRACE: "true",
        LANGSMITH_API_KEY: "ls-key",
        LANGSMITH_PROJECT: "next-agent-debug",
      }),
    ).toEqual({
      ok: true,
      value: {
        enabled: true,
        apiKey: "ls-key",
        project: "next-agent-debug",
      },
    });
  });

  test("rejects a value that is not true or false", () => {
    expect(parseDebugTraceConfig({ NEXT_AGENT_DEBUG_TRACE: "1" })).toEqual({
      ok: false,
      names: ["NEXT_AGENT_DEBUG_TRACE"],
    });
  });
});
