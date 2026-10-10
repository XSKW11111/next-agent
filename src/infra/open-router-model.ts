import { z } from "zod";
import type { AgentConfig } from "./agent-config";
import type { ScriptedModel, ScriptedReply, SupportMessage } from "@/service/agent/support-turn";

const toolNames = ["lookup_order", "search_products", "claim_early_risers", "capture_handoff"] as const;

const toolNameSchema = z.enum(toolNames);

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
                  name: toolNameSchema,
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
        properties: {
          request: { type: "string" },
        },
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
] as const;

type ChatMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly tool_calls?: readonly {
        readonly id: string;
        readonly type: "function";
        readonly function: { readonly name: string; readonly arguments: string };
      }[];
    }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export function openRouterModel(config: AgentConfig, fetchImpl: typeof fetch): ScriptedModel {
  return {
    async complete(input) {
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: toChatMessages(input.systemPrompt, input.messages),
          tools,
        }),
      });
      if (!response.ok) {
        throw await failedResponse(response, config.debugToolDetails);
      }
      return readReply(response, config.debugToolDetails);
    },
  };
}

function toChatMessages(systemPrompt: string, messages: readonly SupportMessage[]): ChatMessage[] {
  return [{ role: "system", content: systemPrompt }, ...messages.map(toChatMessage)];
}

function toChatMessage(message: SupportMessage): ChatMessage {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      return assistantMessage(message);
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    default: {
      const unexpected: never = message;
      return unexpected;
    }
  }
}

function assistantMessage(
  message: Extract<SupportMessage, { role: "assistant" }>,
): ChatMessage {
  if (message.toolCalls.length === 0) {
    return { role: "assistant", content: message.content };
  }
  return {
    role: "assistant",
    content: message.content,
    tool_calls: message.toolCalls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: {
        name: call.name,
        arguments: JSON.stringify(call.args),
      },
    })),
  };
}

async function failedResponse(response: Response, debugToolDetails: boolean): Promise<Error> {
  const status = response.status;
  if (!debugToolDetails) {
    return new Error(`OpenRouter chat completion failed with status ${status}`);
  }
  const body = await response.text();
  return new Error(`OpenRouter chat completion failed with status ${status}: ${body}`);
}

async function readReply(response: Response, debugToolDetails: boolean): Promise<ScriptedReply> {
  const payload: unknown = await response.json().catch(() => undefined);
  const parsed = completionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      debugToolDetails
        ? `OpenRouter chat completion is invalid: ${JSON.stringify(payload)}`
        : "OpenRouter chat completion is invalid",
    );
  }
  const message = parsed.data.choices[0]?.message;
  if (message === undefined) {
    throw new Error("OpenRouter chat completion is invalid");
  }
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    args: parseArguments(call.function.arguments, debugToolDetails),
  }));
  return {
    text: message.content ?? "",
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };
}

function parseArguments(raw: string, debugToolDetails: boolean): unknown {
  try {
    const value: unknown = JSON.parse(raw);
    return value;
  } catch {
    throw new Error(
      debugToolDetails
        ? `OpenRouter tool call arguments are invalid: ${raw}`
        : "OpenRouter tool call arguments are invalid",
    );
  }
}
