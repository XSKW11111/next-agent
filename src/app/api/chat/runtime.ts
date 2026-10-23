import type { AgentConfig } from "@/infra/agent-config";
import { liveChatRuntime } from "@/infra/live-runtime";
import type { Session, SessionId } from "../../../domain/session";
import type { ScriptedModel, SupportTurnDependencies } from "../../../service/agent/support-turn";
import type { ProposalStore } from "../../../service/business/handoff/handoff";
import type { ToolCardStore } from "../../../service/tool/customer-tool-cards";
import type { MessageStore } from "../../../service/turn/message-store";
import type { TurnTracingSession } from "../../../service/turn/submit-traced-turn";

export type SessionStore = {
  save(session: Session, ownerHash: string): Promise<void>;
  findOwned(id: SessionId, ownerHash: string): Promise<Session | undefined>;
};

export type ChatRuntime = {
  readonly config: AgentConfig;
  readonly sessions: SessionStore;
  readonly messages: MessageStore;
  readonly proposals: ProposalStore;
  readonly toolCards: ToolCardStore;
  readonly model: ScriptedModel;
  readonly dependencies: SupportTurnDependencies;
  readonly newSessionId: () => string;
  readonly turnTracing: TurnTracingSession;
  readonly terminalObservability: boolean;
  readonly maxToolRounds?: number;
  readonly productMatchThreshold?: number;
  readonly maxProductCandidates?: number;
};

let installedChatRuntime: ChatRuntime | undefined;

export function installChatRuntime(runtime: ChatRuntime): void {
  installedChatRuntime = runtime;
}

export function currentChatRuntime(): ChatRuntime {
  if (installedChatRuntime === undefined) {
    installedChatRuntime = liveChatRuntime(process.env);
  }
  return installedChatRuntime;
}
