import { describe, expect, test } from "vitest";
import { loadAgentConfig, parseAgentConfig } from "@/infra/agent-config";

const validEnv = {
  OPENROUTER_API_KEY: "test-key",
  AI_MODEL: "openai/gpt-4o",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  PRODUCT_MATCH_THRESHOLD: "0.30",
  MAX_PRODUCT_CANDIDATES: "5",
  MAX_TOOL_ROUNDS: "6",
  CONTEXT_WINDOW_TOKENS: "128000",
  CONTEXT_HARD_TOKENS: "120000",
  NEXT_AGENT_DEBUG_TOOL_DETAILS: "false",
};

const valid = {
  ...validEnv,
  OPENROUTER_API_KEY: "test-openrouter-token",
} as const;

describe("parseAgentConfig", () => {
  test("reads the example names into the agent config", () => {
    const parsed = parseAgentConfig(validEnv);
    expect(parsed).toEqual({
      ok: true,
      value: {
        openRouterApiKey: "test-key",
        model: "openai/gpt-4o",
        supabaseUrl: "https://example.supabase.co",
        supabaseServiceRoleKey: "test-service-role",
        productMatchThreshold: 0.3,
        maxProductCandidates: 5,
        maxToolRounds: 6,
        contextWindowTokens: 128000,
        contextHardTokens: 120000,
        debugToolDetails: false,
      },
    });
  });

  test("names the missing key and omits its value", () => {
    const parsed = parseAgentConfig({ ...validEnv, OPENROUTER_API_KEY: "   " });
    expect(parsed).toEqual({ ok: false, names: ["OPENROUTER_API_KEY"] });
  });

  test("rejects a hard budget larger than the window", () => {
    const parsed = parseAgentConfig({
      ...validEnv,
      CONTEXT_HARD_TOKENS: "200000",
    });
    expect(parsed).toEqual({ ok: false, names: ["CONTEXT_HARD_TOKENS"] });
  });

  test("treats the debug flag as a boolean", () => {
    const parsed = parseAgentConfig({ ...validEnv, NEXT_AGENT_DEBUG_TOOL_DETAILS: "true" });
    expect(parsed.ok && parsed.value.debugToolDetails).toBe(true);
  });
});

test("a full record parses to the agent config", () => {
  expect(loadAgentConfig(valid)).toEqual({
    openRouterApiKey: "test-openrouter-token",
    model: "openai/gpt-4o",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "test-service-role",
    productMatchThreshold: 0.3,
    maxProductCandidates: 5,
    maxToolRounds: 6,
    contextWindowTokens: 128000,
    contextHardTokens: 120000,
    debugToolDetails: false,
  });
});

test("a missing OPENROUTER_API_KEY names that field", () => {
  expect(() => loadAgentConfig({ ...valid, OPENROUTER_API_KEY: undefined })).toThrow(
    "OPENROUTER_API_KEY is required",
  );
});

test("CONTEXT_HARD_TOKENS must be below CONTEXT_WINDOW_TOKENS", () => {
  expect(() => loadAgentConfig({ ...valid, CONTEXT_HARD_TOKENS: "128000" })).toThrow(
    "CONTEXT_HARD_TOKENS must be less than CONTEXT_WINDOW_TOKENS",
  );
  expect(() => loadAgentConfig({ ...valid, CONTEXT_HARD_TOKENS: "200000" })).toThrow(
    "CONTEXT_HARD_TOKENS must be less than CONTEXT_WINDOW_TOKENS",
  );
});

test("MAX_TOOL_ROUNDS above 12 is rejected", () => {
  expect(() => loadAgentConfig({ ...valid, MAX_TOOL_ROUNDS: "13" })).toThrow(
    "MAX_TOOL_ROUNDS must be from 1 to 12",
  );
});

test("an invalid SUPABASE_URL names the field and omits the value", () => {
  expect(() => loadAgentConfig({ ...valid, SUPABASE_URL: "not-a-url" })).toThrow("SUPABASE_URL is invalid");
});
