import type { Session, SessionId } from "../../../domain/session";
import type { ScriptedModel, SupportTurnDependencies } from "../../../service/agent/support-turn";
import type { ProposalStore } from "../../../service/business/handoff/handoff";
import type { MessageStore, TurnMessage } from "../../../service/turn/message-store";

export type SessionStore = {
  save(session: Session): void;
  find(id: SessionId): Session | undefined;
};

export type ChatMessageLog = MessageStore & {
  messagesForSession(sessionId: SessionId): Promise<readonly TurnMessage[]>;
};

export type ChatRuntime = {
  readonly sessions: SessionStore;
  readonly messages: ChatMessageLog;
  readonly proposals: ProposalStore;
  readonly model: ScriptedModel;
  readonly dependencies: SupportTurnDependencies;
  readonly newSessionId: () => string;
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
    throw new Error("chat runtime is not installed");
  }
  return installedChatRuntime;
}
