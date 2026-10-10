import { z } from "zod";

const requiredText = z.string().trim().min(1);
const positiveInt = z.coerce.number().int().positive();

const envSchema = z
  .object({
    OPENROUTER_API_KEY: requiredText,
    AI_MODEL: requiredText,
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: requiredText,
    PRODUCT_MATCH_THRESHOLD: z.coerce.number().gt(0).lte(1),
    MAX_PRODUCT_CANDIDATES: positiveInt.max(20),
    MAX_TOOL_ROUNDS: positiveInt.max(12),
    CONTEXT_WINDOW_TOKENS: positiveInt,
    CONTEXT_HARD_TOKENS: positiveInt,
    NEXT_AGENT_DEBUG_TOOL_DETAILS: z.enum(["true", "false"]),
  })
  .superRefine((env, context) => {
    if (env.CONTEXT_HARD_TOKENS > env.CONTEXT_WINDOW_TOKENS) {
      context.addIssue({
        code: "custom",
        path: ["CONTEXT_HARD_TOKENS"],
        message: "hard token budget exceeds the window",
      });
    }
  });

export type AgentConfig = {
  readonly openRouterApiKey: string;
  readonly model: string;
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string;
  readonly productMatchThreshold: number;
  readonly maxProductCandidates: number;
  readonly maxToolRounds: number;
  readonly contextWindowTokens: number;
  readonly contextHardTokens: number;
  readonly debugToolDetails: boolean;
};

export type AgentConfigFailure = {
  readonly ok: false;
  readonly names: readonly string[];
};

export function parseAgentConfig(
  env: Readonly<Record<string, string | undefined>>,
): { readonly ok: true; readonly value: AgentConfig } | AgentConfigFailure {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, names: fieldNames(parsed.error.issues) };
  }
  return {
    ok: true,
    value: {
      openRouterApiKey: parsed.data.OPENROUTER_API_KEY,
      model: parsed.data.AI_MODEL,
      supabaseUrl: parsed.data.SUPABASE_URL,
      supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
      productMatchThreshold: parsed.data.PRODUCT_MATCH_THRESHOLD,
      maxProductCandidates: parsed.data.MAX_PRODUCT_CANDIDATES,
      maxToolRounds: parsed.data.MAX_TOOL_ROUNDS,
      contextWindowTokens: parsed.data.CONTEXT_WINDOW_TOKENS,
      contextHardTokens: parsed.data.CONTEXT_HARD_TOKENS,
      debugToolDetails: parsed.data.NEXT_AGENT_DEBUG_TOOL_DETAILS === "true",
    },
  };
}

function fieldNames(issues: readonly { readonly path: readonly PropertyKey[] }[]): readonly string[] {
  const names = issues.flatMap((issue) => {
    const name = issue.path[0];
    return typeof name === "string" ? [name] : [];
  });
  return [...new Set(names)];
}
