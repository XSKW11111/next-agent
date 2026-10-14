import { z } from "zod";

export type DebugTraceConfig = {
  readonly enabled: boolean;
  /** LangSmith when keys exist; local in-memory + disk when they do not. */
  readonly sink: "off" | "local" | "langsmith";
  readonly apiKey: string;
  readonly project: string;
};

export type DebugTraceConfigFailure = {
  readonly ok: false;
  readonly names: readonly string[];
};

const requiredText = z.string().trim().min(1);

/**
 * Parsed only by debug entrypoints — not merged into the required customer env schema.
 * Absent or `false` means tracing off. `true` with LangSmith keys uses LangSmith.
 * `true` without keys uses the local sink so latency and traces still persist on disk.
 */
export function parseDebugTraceConfig(
  env: Readonly<Record<string, string | undefined>>,
): { readonly ok: true; readonly value: DebugTraceConfig } | DebugTraceConfigFailure {
  const flag = env.NEXT_AGENT_DEBUG_TRACE;
  if (flag === undefined || flag === "" || flag === "false") {
    return { ok: true, value: traceConfigDisabled() };
  }
  if (flag !== "true") {
    return { ok: false, names: ["NEXT_AGENT_DEBUG_TRACE"] };
  }

  const apiKey = requiredText.safeParse(env.LANGSMITH_API_KEY);
  const project = requiredText.safeParse(env.LANGSMITH_PROJECT);
  if (apiKey.success && project.success) {
    return {
      ok: true,
      value: {
        enabled: true,
        sink: "langsmith",
        apiKey: apiKey.data,
        project: project.data,
      },
    };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      sink: "local",
      apiKey: "",
      project: "local",
    },
  };
}

export function traceConfigDisabled(): DebugTraceConfig {
  return { enabled: false, sink: "off", apiKey: "", project: "" };
}
