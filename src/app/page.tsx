"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { handoffPartSchema, type HandoffPart } from "../domain/handoff";
import { loadChatSession, supportHistorySchema, supportMessages } from "./chat-session";

type SessionLoad =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; sessionId: string; history: UIMessage[] };

export default function Page() {
  const [load, setLoad] = useState<SessionLoad>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadChatSession({
      storage: sessionStorage,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      request: requestSession,
    })
      .then(async (sessionId) => {
        const history = await requestHistory(sessionId);
        if (!cancelled) setLoad({ kind: "ready", sessionId, history });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <SessionGate load={load} />
    </main>
  );
}

function SessionGate({ load }: { load: SessionLoad }) {
  switch (load.kind) {
    case "loading":
      return <p className="p-6 text-muted-foreground">Starting</p>;
    case "failed":
      return <p className="p-6 text-muted-foreground">The chat could not start.</p>;
    case "ready":
      return <SupportChat sessionId={load.sessionId} history={load.history} />;
    default: {
      const unexpected: never = load;
      return unexpected;
    }
  }
}

function SupportChat({ sessionId, history }: { sessionId: string; history: UIMessage[] }) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/chat/sessions/${sessionId}/messages`,
        prepareSendMessagesRequest({ messages }) {
          return {
            body: {
              turnId: crypto.randomUUID(),
              text: lastUserText(messages),
            },
          };
        },
      }),
    [sessionId],
  );
  const { messages, sendMessage, setMessages, status, stop } = useChat({
    transport,
    messages: history,
  });

  function onSubmit(message: PromptInputMessage) {
    const text = message.text.trim();
    if (text === "") return;
    void sendMessage({ text });
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
      <h1 className="px-4 pt-6 text-lg font-semibold">Support</h1>
      <Conversation className="min-h-0">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="How can we help?"
              description="Ask about an order, a product, or Early Risers."
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, index) => (
                    <MessagePart
                      key={`${message.id}-${index}`}
                      part={part}
                      sessionId={sessionId}
                      setMessages={setMessages}
                    />
                  ))}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {status === "error" ? (
        <p className="px-4 text-sm text-muted-foreground">The message was not sent.</p>
      ) : null}
      <div className="p-4">
        <PromptInput onSubmit={onSubmit}>
          <PromptInputBody>
            <PromptInputTextarea placeholder="Message" />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

async function requestHistory(sessionId: string): Promise<UIMessage[]> {
  const response = await fetch(`/api/chat/sessions/${sessionId}/messages`);
  if (!response.ok) throw new Error("history was not loaded");
  const body: unknown = await response.json();
  const parsed = supportHistorySchema.safeParse(body);
  if (!parsed.success) throw new Error("history was not loaded");
  return supportMessages(parsed.data.messages, parsed.data.proposals);
}

async function requestSession(timezone: string): Promise<string> {
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timezone }),
  });
  if (!response.ok) throw new Error("session was not created");
  const body: unknown = await response.json();
  const parsed = z.strictObject({ id: z.uuid() }).safeParse(body);
  if (!parsed.success) throw new Error("session id was missing");
  return parsed.data.id;
}

function MessagePart({
  part,
  sessionId,
  setMessages,
}: {
  part: UIMessage["parts"][number];
  sessionId: string;
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
}) {
  if (part.type === "text") {
    return <MessageResponse>{part.text}</MessageResponse>;
  }
  if (part.type !== "data-handoff") return null;
  const parsed = handoffPartSchema.safeParse(part.data);
  if (!parsed.success) return null;
  return (
    <HandoffControl
      sessionId={sessionId}
      proposalId={part.id ?? parsed.data.proposalId}
      decision={parsed.data.decision}
      setMessages={setMessages}
    />
  );
}

function HandoffControl({
  sessionId,
  proposalId,
  decision,
  setMessages,
}: {
  sessionId: string;
  proposalId: string;
  decision: HandoffPart["decision"];
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
}) {
  switch (decision) {
    case "pending":
      return (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-1 text-sm"
            onClick={() => {
              void postHandoffDecision(sessionId, proposalId, "confirm", setMessages);
            }}
          >
            Confirm
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-1 text-sm"
            onClick={() => {
              void postHandoffDecision(sessionId, proposalId, "cancel", setMessages);
            }}
          >
            Cancel
          </button>
        </div>
      );
    case "confirmed":
      return <p>Confirmed</p>;
    case "cancelled":
      return <p>Cancelled</p>;
    default: {
      const unexpected: never = decision;
      return unexpected;
    }
  }
}

async function postHandoffDecision(
  sessionId: string,
  proposalId: string,
  command: "confirm" | "cancel",
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void,
): Promise<void> {
  const response = await fetch(`/api/chat/sessions/${sessionId}/handoffs/${proposalId}/${command}`, {
    method: "POST",
  });
  if (!response.ok) return;
  const decision = decisionFor(command);
  setMessages((current) =>
    current.map((message) => ({
      ...message,
      parts: message.parts.map((part) =>
        part.type === "data-handoff" && (part.id ?? handoffId(part.data)) === proposalId
          ? { type: "data-handoff" as const, id: proposalId, data: { proposalId, decision } }
          : part,
      ),
    })),
  );
}

function decisionFor(command: "confirm" | "cancel"): "confirmed" | "cancelled" {
  switch (command) {
    case "confirm":
      return "confirmed";
    case "cancel":
      return "cancelled";
    default: {
      const unexpected: never = command;
      return unexpected;
    }
  }
}

function handoffId(data: unknown): string | undefined {
  const parsed = handoffPartSchema.safeParse(data);
  if (!parsed.success) return undefined;
  return parsed.data.proposalId;
}

function lastUserText(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") continue;
    return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  }
  return "";
}
