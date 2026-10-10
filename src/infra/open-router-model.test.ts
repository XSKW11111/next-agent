import { expect, test } from "vitest";
import type { AgentConfig } from "./agent-config";
import { openRouterModel } from "./open-router-model";

const config: AgentConfig = {
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
};

test("the adapter sends the bearer token and model and maps a tool call", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    seen = { url: String(url), init: init ?? {} };
    return Response.json({
      choices: [
        {
          message: {
            content: "Checking that.",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "lookup_order",
                  arguments: JSON.stringify({ email: "ada@example.com" }),
                },
              },
            ],
          },
        },
      ],
    });
  };

  const reply = await openRouterModel(config, fetchImpl).complete({
    systemPrompt: "You help customers.",
    messages: [
      { role: "user", content: "Where is my order?" },
      {
        role: "assistant",
        content: "Looking it up.",
        toolCalls: [{ id: "lookup-1", name: "lookup_order", args: { email: "ada@example.com" } }],
      },
      {
        role: "tool",
        toolCallId: "lookup-1",
        name: "lookup_order",
        content: "{\"kind\":\"orders_found\"}",
      },
    ],
  });

  expect(reply).toEqual({
    text: "Checking that.",
    toolCalls: [{ id: "call-1", name: "lookup_order", args: { email: "ada@example.com" } }],
  });
  expect(seen?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(seen?.init.method).toBe("POST");
  const headers = new Headers(seen?.init.headers);
  expect(headers.get("authorization")).toBe("Bearer test-openrouter-token");
  expect(headers.get("content-type")).toBe("application/json");
  expect(JSON.parse(String(seen?.init.body))).toEqual({
    model: "openai/gpt-4o",
    messages: [
      { role: "system", content: "You help customers." },
      { role: "user", content: "Where is my order?" },
      {
        role: "assistant",
        content: "Looking it up.",
        tool_calls: [
          {
            id: "lookup-1",
            type: "function",
            function: {
              name: "lookup_order",
              arguments: "{\"email\":\"ada@example.com\"}",
            },
          },
        ],
      },
      { role: "tool", tool_call_id: "lookup-1", content: "{\"kind\":\"orders_found\"}" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "lookup_order",
          parameters: {
            type: "object",
            properties: {
              email: { type: "string" },
              order_number: { type: "string" },
            },
            required: ["email"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_products",
          parameters: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["semantic", "list"] },
              query: { type: "string" },
              filters: { type: "object" },
            },
            required: ["mode"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "claim_early_risers",
          parameters: {
            type: "object",
            properties: { request: { type: "string" } },
            required: ["request"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "capture_handoff",
          parameters: {
            type: "object",
            properties: {
              contact_email: { type: "string" },
              reason: { type: "string" },
              order_number: { type: "string" },
            },
            required: ["contact_email", "reason"],
            additionalProperties: false,
          },
        },
      },
    ],
  });
});

test("a 401 with debug details off omits the response body", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("upstream-body-should-stay-hidden", { status: 401 });

  let thrown: unknown;
  try {
    await openRouterModel(config, fetchImpl).complete({
      systemPrompt: "You help customers.",
      messages: [{ role: "user", content: "Where is my order?" }],
    });
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof Error)) throw new Error("expected the completion to throw");
  expect(thrown.message).toBe("OpenRouter chat completion failed with status 401");
  expect(thrown.message).not.toContain("upstream-body-should-stay-hidden");
});
