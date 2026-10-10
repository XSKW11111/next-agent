import { describe, expect, test } from "vitest";
import { parseAgentConfig } from "@/infra/agent-config";
import { openRouterModel } from "@/infra/openrouter-model";
import type { SupportMessage } from "@/service/agent/support-turn";

const config = parsedConfig();

describe("openRouterModel", () => {
  test("sends the key and model, then maps a tool call back", async () => {
    const seen: { authorization?: string | null; body?: unknown } = {};
    const model = openRouterModel(config, async (_input, init) => {
      seen.authorization = new Headers(init?.headers).get("authorization");
      seen.body = JSON.parse(String(init?.body));
      return Response.json({
        choices: [
          {
            message: {
              content: "On the way.",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "lookup_order",
                    arguments: JSON.stringify({ email: "a@b.co" }),
                  },
                },
              ],
            },
          },
        ],
      });
    });

    const reply = await model.complete({
      systemPrompt: "Help the customer.",
      messages: thread(),
    });

    expect(seen.authorization).toBe("Bearer test-key");
    expect(seen.body).toMatchObject({
      model: "openai/gpt-4o",
      messages: [
        { role: "system", content: "Help the customer." },
        { role: "user", content: "Where is my order?" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call-0",
              type: "function",
              function: { name: "lookup_order", arguments: JSON.stringify({ email: "a@b.co" }) },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-0", content: "ready" },
      ],
    });
    expect(reply).toEqual({
      text: "On the way.",
      toolCalls: [{ id: "call-1", name: "lookup_order", args: { email: "a@b.co" } }],
    });
  });

  test("reports the status and leaves the key out of the error", async () => {
    const model = openRouterModel(
      { ...config, openRouterApiKey: "secret-key" },
      async () => new Response("no", { status: 401 }),
    );
    await expect(model.complete({ systemPrompt: "Help.", messages: [] })).rejects.toThrow(
      "model request failed (401)",
    );
  });
});

function thread(): SupportMessage[] {
  return [
    { role: "user", content: "Where is my order?" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call-0", name: "lookup_order", args: { email: "a@b.co" } }],
    },
    { role: "tool", toolCallId: "call-0", name: "lookup_order", content: "ready" },
  ];
}

function parsedConfig() {
  const parsed = parseAgentConfig({
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
  });
  if (!parsed.ok) throw new Error("fixture config did not parse");
  return parsed.value;
}
