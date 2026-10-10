import type { AgentConfig } from "@/infra/agent-config";
import type { ScriptedModel, ScriptedReply, SupportMessage } from "@/service/agent/support-turn";
import { z } from "zod";

const toolNames = ["lookup_order", "search_products", "claim_early_risers", "capture_handoff"] as const;

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                function: z.object({
                  name: z.enum(toolNames),
                  arguments: z.string(),
                }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
});

const tools = [
  {
    type: "function",
    function: {
      name: "lookup_order",
      description: "Look up orders for an email, optionally narrowed to one order number.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          email: { type: "string" },
          order_number: { type: "string" },
        },
        required: ["email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Search the catalog by meaning or list products that match filters.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["semantic", "list"] },
          query: { type: "string" },
          filters: { type: "object" },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "claim_early_risers",
      description: "Claim the early risers promotion when the customer asks for it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          request: { type: "string" },
        },
        required: ["request"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_handoff",
      description: "Record a request for a person to take the conversation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          contact_email: { type: "string" },
          reason: { type: "string" },
          order_number: { type: "string" },
        },
        required: ["contact_email", "reason"],
      },
    },
  },
] as const;

export function openRouterModel(config: AgentConfig, fetchImpl: typeof fetch = fetch): ScriptedModel {
  return {
    async complete(input) {
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "system", content: input.systemPrompt }, ...input.messages.map(wireMessage)],
          tools,
        }),
      });
      if (!response.ok) {
        throw new Error(`model request failed (${response.status})`);
      }
      const body: unknown = await response.json();
      return scriptedReply(body);
    },
  };
}

function wireMessage(message: SupportMessage): Record<string, unknown> {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    default: {
      const unreachable: never = message;
      return unreachable;
    }
  }
}

function scriptedReply(body: unknown): ScriptedReply {
  const parsed = completionSchema.safeParse(body);
  const message = parsed.success ? parsed.data.choices[0]?.message : undefined;
  if (message === undefined) {
    throw new Error("model reply is invalid");
  }
  const toolCalls = message.tool_calls?.map((call) => ({
    id: call.id,
    name: call.function.name,
    args: parseArguments(call.function.arguments),
  }));
  return {
    text: message.content ?? "",
    ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { toolCalls }),
  };
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("model reply is invalid");
  }
}
