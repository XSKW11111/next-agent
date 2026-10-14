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

  test("uses the local sink when tracing is on without LangSmith keys", () => {
    expect(parseDebugTraceConfig({ NEXT_AGENT_DEBUG_TRACE: "true" })).toEqual({
      ok: true,
      value: {
        enabled: true,
        sink: "local",
        apiKey: "",
        project: "local",
      },
    });
  });

  test("reads the LangSmith settings when both keys are present", () => {
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
        sink: "langsmith",
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
