import { getEncoding } from "js-tiktoken";
import { z } from "zod";
import type { AgentConfig } from "./agent-config";
import { contextWindowTokens } from "@/service/agent/context-summary";
import type { ScriptedModel, ScriptedReply, SupportMessage } from "@/service/agent/support-turn";
import { observeProvider, type ReportedUsage } from "./langsmith/turn-trace-context";

const contextEncoder = getEncoding("cl100k_base");

const toolNames = ["lookup_order", "search_products", "claim_early_risers", "capture_handoff"] as const;

const toolNameSchema = z.enum(toolNames);

const completionSchema = z.object({
  model: z.unknown().optional(),
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
  usage: z.unknown().optional(),
});

const tokenUsage = z.number().int().nonnegative().optional().catch(undefined);
const costUsage = z.number().finite().nonnegative().optional().catch(undefined);

const usageSchema = z.object({
  prompt_tokens: tokenUsage,
  completion_tokens: tokenUsage,
  total_tokens: tokenUsage,
  prompt_tokens_details: z.object({
    cached_tokens: tokenUsage,
    cache_write_tokens: tokenUsage,
    audio_tokens: tokenUsage,
    image_tokens: tokenUsage,
    video_tokens: tokenUsage,
  }).optional().catch(undefined),
  completion_tokens_details: z.object({
    reasoning_tokens: tokenUsage,
    audio_tokens: tokenUsage,
    image_tokens: tokenUsage,
  }).optional().catch(undefined),
  cost: costUsage,
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

export class ContextBudgetExceeded extends Error {
  constructor() {
    super("context hard cap exceeded");
    this.name = "ContextBudgetExceeded";
  }
}

export function openRouterModel(config: AgentConfig, fetchImpl: typeof fetch): ScriptedModel {
  return {
    async summarize(prompt) {
      return observeProvider({ kind: "model", operation: "summary", model: config.model }, async () => {
        const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 20_000,
          usage: { include: true },
        }),
      });
        if (!response.ok) throw await failedResponse(response, config.debugToolDetails);
        const completion = await readReply(response, config.debugToolDetails);
        return { value: completion.reply.text, ...(completion.usage === undefined ? {} : { usage: completion.usage }), ...(completion.model === undefined ? {} : { model: completion.model }) };
      });
    },
    async complete(input) {
      const messages = fitContext(
        toChatMessages(input.systemPrompt, input.messages),
        tools,
        contextWindowTokens,
      );
      return observeProvider({ kind: "model", operation: "chat", model: config.model }, async () => {
        const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openRouterApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          tools,
          usage: { include: true },
        }),
      });
        if (!response.ok) throw await failedResponse(response, config.debugToolDetails);
        const completion = await readReply(response, config.debugToolDetails);
        return { value: completion.reply, ...(completion.usage === undefined ? {} : { usage: completion.usage }), ...(completion.model === undefined ? {} : { model: completion.model }) };
      });
    },
  };
}

function tokenCount(value: unknown): number {
  return contextEncoder.encode(JSON.stringify(value)).length;
}

function fitContext(
  messages: readonly ChatMessage[],
  tools: readonly unknown[],
  hardTokens: number,
): ChatMessage[] {
  const system = messages[0];
  if (system?.role !== "system") {
    throw new Error("context fit requires a system message");
  }
  const protectedStart = lastUserIndex(messages);
  let prefix = messages.slice(1, protectedStart);
  const suffix = messages.slice(protectedStart);
  while (
    prefix.length > 0 &&
    tokenCount({ messages: [system, ...prefix, ...suffix], tools }) > hardTokens
  ) {
    prefix = prefix.slice(prefixDropCount(prefix));
  }
  const fitted = [system, ...prefix, ...suffix];
  if (tokenCount({ messages: fitted, tools }) > hardTokens) {
    throw new ContextBudgetExceeded();
  }
  return fitted;
}

function lastUserIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return index;
  }
  return 1;
}

function prefixDropCount(prefix: readonly ChatMessage[]): 1 | 2 {
  const first = prefix[0];
  const second = prefix[1];
  if (first === undefined) return 1;
  switch (first.role) {
    case "user":
      return second?.role === "assistant" ? 2 : 1;
    case "system":
    case "assistant":
    case "tool":
      return 1;
    default: {
      const unexpected: never = first;
      return unexpected;
    }
  }
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

async function readReply(response: Response, debugToolDetails: boolean): Promise<{ readonly reply: ScriptedReply; readonly usage?: ReportedUsage; readonly model?: string }> {
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
  const parsedUsage = usageSchema.safeParse(parsed.data.usage);
  const usage = parsedUsage.success ? reportedUsage(parsedUsage.data) : undefined;
  return {
    reply: { text: message.content ?? "", ...(toolCalls.length === 0 ? {} : { toolCalls }) },
    ...(usage === undefined ? {} : { usage }),
    ...(typeof parsed.data.model === "string" && parsed.data.model.trim().length > 0 ? { model: parsed.data.model } : {}),
  };
}

function reportedUsage(raw: z.infer<typeof usageSchema>): ReportedUsage | undefined {
  const usage: ReportedUsage = {
    ...(raw.prompt_tokens === undefined ? {} : { inputTokens: raw.prompt_tokens }),
    ...(raw.completion_tokens === undefined ? {} : { outputTokens: raw.completion_tokens }),
    ...(raw.total_tokens === undefined ? {} : { totalTokens: raw.total_tokens }),
    ...(raw.prompt_tokens_details?.cached_tokens === undefined ? {} : { cachedInputTokens: raw.prompt_tokens_details.cached_tokens }),
    ...(raw.prompt_tokens_details?.cache_write_tokens === undefined ? {} : { cacheWriteTokens: raw.prompt_tokens_details.cache_write_tokens }),
    ...(raw.prompt_tokens_details?.audio_tokens === undefined ? {} : { audioInputTokens: raw.prompt_tokens_details.audio_tokens }),
    ...(raw.prompt_tokens_details?.image_tokens === undefined ? {} : { imageInputTokens: raw.prompt_tokens_details.image_tokens }),
    ...(raw.prompt_tokens_details?.video_tokens === undefined ? {} : { videoInputTokens: raw.prompt_tokens_details.video_tokens }),
    ...(raw.completion_tokens_details?.reasoning_tokens === undefined ? {} : { reasoningOutputTokens: raw.completion_tokens_details.reasoning_tokens }),
    ...(raw.completion_tokens_details?.audio_tokens === undefined ? {} : { audioOutputTokens: raw.completion_tokens_details.audio_tokens }),
    ...(raw.completion_tokens_details?.image_tokens === undefined ? {} : { imageOutputTokens: raw.completion_tokens_details.image_tokens }),
    ...(raw.cost === undefined ? {} : { totalCost: raw.cost }),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
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
