import { z } from "zod";

const requiredTextSchema = z.string().trim().min(1);
const positiveInt = z.coerce.number().int().positive();

const envSchema = z
  .object({
    OPENROUTER_API_KEY: requiredTextSchema,
    AI_MODEL: requiredTextSchema,
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: requiredTextSchema,
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

export function loadAgentConfig(source: Readonly<Record<string, string | undefined>>): AgentConfig {
  const openRouterApiKey = requiredText(source, "OPENROUTER_API_KEY");
  const model = requiredText(source, "AI_MODEL");
  const supabaseUrl = requiredUrl(source, "SUPABASE_URL");
  const supabaseServiceRoleKey = requiredText(source, "SUPABASE_SERVICE_ROLE_KEY");
  const productMatchThreshold = requiredThreshold(source, "PRODUCT_MATCH_THRESHOLD");
  const maxProductCandidates = requiredPositiveInteger(source, "MAX_PRODUCT_CANDIDATES");
  const maxToolRounds = requiredToolRounds(source, "MAX_TOOL_ROUNDS");
  const contextWindowTokens = requiredPositiveInteger(source, "CONTEXT_WINDOW_TOKENS");
  const contextHardTokens = requiredPositiveInteger(source, "CONTEXT_HARD_TOKENS");
  const debugToolDetails = requiredBoolean(source, "NEXT_AGENT_DEBUG_TOOL_DETAILS");
  if (contextHardTokens >= contextWindowTokens) {
    throw new Error("CONTEXT_HARD_TOKENS must be less than CONTEXT_WINDOW_TOKENS");
  }
  return {
    openRouterApiKey,
    model,
    supabaseUrl,
    supabaseServiceRoleKey,
    productMatchThreshold,
    maxProductCandidates,
    maxToolRounds,
    contextWindowTokens,
    contextHardTokens,
    debugToolDetails,
  };
}

function requiredText(source: Readonly<Record<string, string | undefined>>, field: string): string {
  const value = source[field];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function requiredUrl(source: Readonly<Record<string, string | undefined>>, field: string): string {
  const value = requiredText(source, field);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} is invalid`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function requiredThreshold(source: Readonly<Record<string, string | undefined>>, field: string): number {
  const value = requiredText(source, field);
  if (!/^(?:0\.\d*[1-9]\d*|1(?:\.0+)?)$/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return Number(value);
}

function requiredPositiveInteger(
  source: Readonly<Record<string, string | undefined>>,
  field: string,
): number {
  const value = requiredText(source, field);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return Number(value);
}

function requiredToolRounds(source: Readonly<Record<string, string | undefined>>, field: string): number {
  const value = requiredPositiveInteger(source, field);
  if (value > 12) {
    throw new Error(`${field} must be from 1 to 12`);
  }
  return value;
}

function requiredBoolean(source: Readonly<Record<string, string | undefined>>, field: string): boolean {
  const value = source[field];
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === undefined || value === "") {
    throw new Error(`${field} is required`);
  }
  throw new Error(`${field} is invalid`);
}
