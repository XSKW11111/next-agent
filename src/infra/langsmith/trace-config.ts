import { z } from "zod";

export type LangSmithTraceConfig = {
  readonly apiKey: string;
  readonly project: string;
};

type ConfigResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly names: readonly string[] };

const requiredText = z.string().trim().min(1);

export function parseLangSmithTraceConfig(
  env: Readonly<Record<string, string | undefined>>,
): ConfigResult<LangSmithTraceConfig> {
  const apiKey = requiredText.safeParse(env.LANGSMITH_API_KEY);
  const project = requiredText.safeParse(env.LANGSMITH_PROJECT);
  const names = [
    ...(apiKey.success ? [] : ["LANGSMITH_API_KEY"]),
    ...(project.success ? [] : ["LANGSMITH_PROJECT"]),
  ];
  if (!apiKey.success || !project.success) return { ok: false, names };
  return { ok: true, value: { apiKey: apiKey.data, project: project.data } };
}

export function parseTerminalObservability(
  env: Readonly<Record<string, string | undefined>>,
): ConfigResult<boolean> {
  const flag = env.NEXT_AGENT_TERMINAL_OBSERVABILITY;
  if (flag !== undefined && flag !== "" && flag !== "true" && flag !== "false") {
    return { ok: false, names: ["NEXT_AGENT_TERMINAL_OBSERVABILITY"] };
  }
  return { ok: true, value: env.VERCEL_ENV !== "production" && env.NODE_ENV !== "production" && flag === "true" };
}
