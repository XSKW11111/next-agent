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

export function loadAgentConfig(
  source: Readonly<Record<string, string | undefined>>,
): AgentConfig {
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

function requiredText(
  source: Readonly<Record<string, string | undefined>>,
  field: string,
): string {
  const value = source[field];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function requiredUrl(
  source: Readonly<Record<string, string | undefined>>,
  field: string,
): string {
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

function requiredThreshold(
  source: Readonly<Record<string, string | undefined>>,
  field: string,
): number {
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

function requiredToolRounds(
  source: Readonly<Record<string, string | undefined>>,
  field: string,
): number {
  const value = requiredPositiveInteger(source, field);
  if (value > 12) {
    throw new Error(`${field} must be from 1 to 12`);
  }
  return value;
}

function requiredBoolean(
  source: Readonly<Record<string, string | undefined>>,
  field: string,
): boolean {
  const value = source[field];
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === undefined || value === "") {
    throw new Error(`${field} is required`);
  }
  throw new Error(`${field} is invalid`);
}
