import { describe, expect, test } from "vitest";
import { orderEmailSchema } from "../domain/order";
import { parse } from "../domain/parse";
import { debugChatRuntimeForTests } from "./debug-runtime";

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
  NEXT_AGENT_DEBUG_TRACE: "true",
  LANGSMITH_API_KEY: "ls-test",
  LANGSMITH_PROJECT: "unit-tests",
};

describe("debugChatRuntime", () => {
  test("fails when tracing is off", () => {
    expect(() =>
      debugChatRuntimeForTests({
        ...validEnv,
        NEXT_AGENT_DEBUG_TRACE: "false",
      }),
    ).toThrow("NEXT_AGENT_DEBUG_TRACE=true");
  });

  test("uses the local sink when LangSmith keys are missing", () => {
    const runtime = debugChatRuntimeForTests({
      ...validEnv,
      LANGSMITH_API_KEY: "",
      LANGSMITH_PROJECT: "",
    });
    expect(runtime.turnTracing.config).toMatchObject({
      enabled: true,
      sink: "local",
      project: "local",
    });
  });

  test("overlays the order-outage catalog", async () => {
    const runtime = debugChatRuntimeForTests(validEnv, { orderCase: "order-outage" });
    expect(runtime.turnTracing.config.enabled).toBe(true);
    const email = parse(orderEmailSchema, "jane.smith@example.com");
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    await expect(runtime.dependencies.orders.catalog.listOrdersForEmail(email.value)).resolves.toEqual({
      kind: "unavailable",
    });
  });
});

