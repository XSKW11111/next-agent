import { describe, expect, test } from "vitest";
import { liveChatRuntime } from "@/infra/live-runtime";

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
  LANGSMITH_API_KEY: "test-langsmith-key",
  LANGSMITH_PROJECT: "next-agent-test",
};

describe("liveChatRuntime", () => {
  test("reads the hosted catalog and carries the parsed model", async () => {
    const runtime = liveChatRuntime(validEnv, async () => {
      throw new Error("fetch was not part of this check");
    });
    await expect(runtime.dependencies.products.catalog.listProducts({ limit: 1, filters: {} })).rejects.toThrow(
      "product list failed",
    );
    expect(runtime.config).toMatchObject({
      model: "openai/gpt-4o",
      maxToolRounds: 6,
      productMatchThreshold: 0.3,
      debugToolDetails: false,
    });
  });

  test("names the missing setting when the process env is incomplete", () => {
    expect(() => liveChatRuntime({ ...validEnv, SUPABASE_URL: "" })).toThrow(
      "agent config is invalid: SUPABASE_URL",
    );
  });
});
