import type { AgentConfig } from "@/infra/agent-config";
import { liveChatRuntime } from "@/infra/live-runtime";
import type { Session, SessionId } from "../../../domain/session";
import type { ScriptedModel, SupportTurnDependencies } from "../../../service/agent/support-turn";
import type { ProposalStore } from "../../../service/handoff/handoff";
import type { MessageStore, TurnMessage } from "../../../service/turn/message-store";

export type SessionStore = {
  save(session: Session): Promise<void>;
  find(id: SessionId): Promise<Session | undefined>;
};

export type ChatMessageLog = MessageStore & {
  messagesForSession(sessionId: SessionId): Promise<readonly TurnMessage[]>;
};

export type ChatRuntime = {
  readonly config: AgentConfig;
  readonly sessions: SessionStore;
  readonly messages: ChatMessageLog;
  readonly proposals: ProposalStore;
  readonly model: ScriptedModel;
  readonly dependencies: SupportTurnDependencies;
  readonly newSessionId: () => string;
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
