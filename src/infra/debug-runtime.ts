import type { ChatRuntime } from "@/app/api/chat/runtime";
import { parseAgentConfig } from "@/infra/agent-config";
import { debugOrderCatalog, type DebugOrderCase } from "@/infra/debug-catalog";
import { parseDebugTraceConfig } from "@/infra/langsmith/debug-trace-config";
import {
  createLangSmithRunsPort,
  memoryLangSmithRunsPort,
  type LangSmithRunsPort,
} from "@/infra/langsmith/langsmith-runs-port";
import { liveChatRuntime } from "@/infra/live-runtime";
import {
  createTurnTracingSession,
  type TurnTracingSession,
} from "@/service/turn/submit-traced-turn";
import type { OrderCatalog } from "@/service/business/order/lookup-order";

export type DebugCatalogOverrides = {
  readonly orderCatalog?: OrderCatalog;
  readonly orderCase?: DebugOrderCase;
};

export type DebugChatRuntime = ChatRuntime & {
  readonly turnTracing: TurnTracingSession;
};

/**
 * Debug / eval host entry. Requires NEXT_AGENT_DEBUG_TRACE=true.
 * Uses LangSmith when keys are set; otherwise an in-memory runs port (local sink).
 */
export function debugChatRuntime(
  env: Readonly<Record<string, string | undefined>>,
  overrides?: DebugCatalogOverrides,
  options?: { readonly runsPort?: LangSmithRunsPort },
): DebugChatRuntime {
  const agent = parseAgentConfig(env);
  if (!agent.ok) {
    throw new Error(`agent config is invalid: ${agent.names.join(", ")}`);
  }
  const debug = parseDebugTraceConfig(env);
  if (!debug.ok) {
    throw new Error(`debug trace config is invalid: ${debug.names.join(", ")}`);
  }
  if (!debug.value.enabled) {
    throw new Error("debugChatRuntime requires NEXT_AGENT_DEBUG_TRACE=true");
  }

  const base = liveChatRuntime(env);
  const orderCatalog =
    overrides?.orderCatalog ??
    (overrides?.orderCase === undefined
      ? base.dependencies.orders.catalog
      : debugOrderCatalog(overrides.orderCase));

  const client =
    options?.runsPort ??
    (debug.value.sink === "langsmith"
      ? createLangSmithRunsPort(debug.value)
      : memoryLangSmithRunsPort());
  const turnTracing = createTurnTracingSession({
    config: debug.value,
    client,
  });

  return {
    ...base,
    turnTracing,
    dependencies: {
      ...base.dependencies,
      orders: {
        ...base.dependencies.orders,
        catalog: orderCatalog,
      },
    },
  };
}

/** Unit-test helper: same gate as debugChatRuntime with an in-memory runs port. */
export function debugChatRuntimeForTests(
  env: Readonly<Record<string, string | undefined>>,
  overrides?: DebugCatalogOverrides,
): DebugChatRuntime & { readonly memoryClient: ReturnType<typeof memoryLangSmithRunsPort> } {
  const memoryClient = memoryLangSmithRunsPort();
  const runtime = debugChatRuntime(env, overrides, { runsPort: memoryClient });
  return { ...runtime, memoryClient };
}
