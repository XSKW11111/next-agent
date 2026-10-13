import { z } from "zod";
import { orderNumberSchema } from "../../domain/order";
import { parse } from "../../domain/parse";

export const maxCallsPerChunk = 8;

const skippedLeadIn = "I could not run these checks in this message: ";

export type ToolName =
  | "lookup_order"
  | "search_products"
  | "claim_early_risers"
  | "capture_handoff";

export type ToolCall<Result> = {
  readonly tool: ToolName;
  readonly run: () => Promise<Result>;
};

type ToolEffect = "read" | "write";

const toolEffect = {
  lookup_order: "write",
  search_products: "read",
  claim_early_risers: "write",
  capture_handoff: "write",
} as const satisfies Record<ToolName, ToolEffect>;

export type ChunkCallPlan = {
  readonly index: number;
  readonly tool: ToolName;
  readonly effect: ToolEffect;
  readonly waitsFor: readonly number[];
};

export type ToolChunkPlan = {
  readonly calls: readonly ChunkCallPlan[];
  readonly writeOrder: readonly number[];
};

const searchArgsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("semantic"),
    query: z.string().trim().min(1),
  }),
  z.object({
    mode: z.literal("list"),
  }),
]);

const claimArgsSchema = z.object({
  request: z.string().trim().min(1),
});

const handoffArgsSchema = z.object({
  contact_email: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export function planToolChunk(tools: readonly ToolName[]): ToolChunkPlan {
  const calls: ChunkCallPlan[] = [];
  const writeOrder: number[] = [];

  for (const [index, tool] of tools.entries()) {
    const effect = toolEffect[tool];
    switch (effect) {
      case "read":
        calls.push({ index, tool, effect, waitsFor: [] });
        break;
      case "write": {
        const previous = writeOrder.at(-1);
        writeOrder.push(index);
        calls.push({
          index,
          tool,
          effect,
          waitsFor: previous === undefined ? [] : [previous],
        });
        break;
      }
      default: {
        const unexpected: never = effect;
        throw new Error(unexpected);
      }
    }
  }

  return { calls, writeOrder };
}

export function skippedChecksSentence(
  calls: readonly { readonly tool: ToolName; readonly args: unknown }[],
): string {
  return `${skippedLeadIn}${calls.map((call) => skippedEntry(call.tool, call.args)).join(", ")}`;
}

function skippedEntry(tool: ToolName, args: unknown): string {
  const descriptor = skippedDescriptor(tool, args);
  if (descriptor === undefined) return tool;
  return `${tool} (${descriptor})`;
}

function skippedDescriptor(tool: ToolName, args: unknown): string | undefined {
  switch (tool) {
    case "lookup_order":
      return lookupDescriptor(args);
    case "search_products":
      return searchDescriptor(args);
    case "claim_early_risers":
      return claimArgsSchema.safeParse(args).success ? "claim" : undefined;
    case "capture_handoff":
      return handoffArgsSchema.safeParse(args).success ? "handoff" : undefined;
    default: {
      const unexpected: never = tool;
      return unexpected;
    }
  }
}

function lookupDescriptor(args: unknown): string | undefined {
  if (!isRecord(args) || typeof args.order_number !== "string") return undefined;
  const parsed = parse(orderNumberSchema, args.order_number);
  if (!parsed.ok) return undefined;
  return parsed.value;
}

function searchDescriptor(args: unknown): string | undefined {
  const parsed = searchArgsSchema.safeParse(args);
  if (!parsed.success) return undefined;
  switch (parsed.data.mode) {
    case "semantic":
      return `mode=semantic query=${parsed.data.query}`;
    case "list":
      return "mode=list";
    default: {
      const unexpected: never = parsed.data;
      return unexpected;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
