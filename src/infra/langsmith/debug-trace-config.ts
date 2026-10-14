import { z } from "zod";

export type DebugTraceConfig = {
  readonly enabled: boolean;
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
 * Absent or `false` means tracing off. `true` requires LangSmith key and project.
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
  const names = [
    ...(apiKey.success ? [] : ["LANGSMITH_API_KEY"]),
    ...(project.success ? [] : ["LANGSMITH_PROJECT"]),
  ];
  if (names.length > 0 || !apiKey.success || !project.success) {
    return { ok: false, names };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      apiKey: apiKey.data,
      project: project.data,
    },
  };
}

export function traceConfigDisabled(): DebugTraceConfig {
  return { enabled: false, apiKey: "", project: "" };
}
