import { describe, expect, test } from "vitest";
import { parseAgentConfig } from "@/infra/agent-config";

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

  test("rejects a hard budget that is not below the window", () => {
    const larger = parseAgentConfig({
      ...validEnv,
      CONTEXT_HARD_TOKENS: "200000",
    });
    const equal = parseAgentConfig({
      ...validEnv,
      CONTEXT_HARD_TOKENS: "128000",
    });
    expect(larger).toEqual({ ok: false, names: ["CONTEXT_HARD_TOKENS"] });
    expect(equal).toEqual({ ok: false, names: ["CONTEXT_HARD_TOKENS"] });
  });

  test("rejects more than 12 tool rounds", () => {
    const parsed = parseAgentConfig({ ...validEnv, MAX_TOOL_ROUNDS: "13" });
    expect(parsed).toEqual({ ok: false, names: ["MAX_TOOL_ROUNDS"] });
  });

  test("names an invalid Supabase URL and omits the value", () => {
    const parsed = parseAgentConfig({ ...validEnv, SUPABASE_URL: "not-a-url" });
    expect(parsed).toEqual({ ok: false, names: ["SUPABASE_URL"] });
    expect(JSON.stringify(parsed).includes("not-a-url")).toBe(false);
  });

  test("treats the debug flag as a boolean", () => {
    const parsed = parseAgentConfig({ ...validEnv, NEXT_AGENT_DEBUG_TOOL_DETAILS: "true" });
    expect(parsed.ok && parsed.value.debugToolDetails).toBe(true);
  });
});
