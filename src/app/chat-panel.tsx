"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Proposal } from "../domain/handoff";
import { ChatCard } from "./chat/chat-card";
import { ChatComposer } from "./chat/chat-composer";
import { ChatHeading } from "./chat/chat-heading";
import { ChatShell } from "./chat/chat-shell";
import { ChatTranscript } from "./chat/chat-transcript";

const HandoffCard = dynamic(() => import("./handoff-card").then((mod) => mod.HandoffCard), { ssr: false });

const sessionKey = "next-agent-session-id";

type StoredMessage = {
  turnId: string;
  role: "customer" | "assistant";
  content: string;
  sequence: number;
};

type HistoryBody = {
  messages: StoredMessage[];
  proposals: Proposal[];
};

type ChatMessage = UIMessage<unknown, { proposal: Proposal }>;

export function ChatPanel() {
  const stored = useSyncExternalStore(subscribeSession, readSession, () => null);
  const [created, setCreated] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sessionId = stored ?? created;

  useEffect(() => {
    if (sessionId !== null) return;
    void startSession(setCreated, setFailed);
  }, [sessionId]);

  if (sessionId === null) {
    return <CleanChat failed={failed} />;
  }
  return <ChatThread key={sessionId} sessionId={sessionId} />;
}

function CleanChat({ failed }: { failed: boolean }) {
  return (
    <ChatLayout
      messages={[]}
      sessionId={null}
      canSend={false}
      notice={failed ? "The chat session could not be started." : undefined}
    />
  );
}

function ChatThread({ sessionId }: { sessionId: string }) {
  const { messages, sendMessage, setMessages, status } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: `/api/chat/sessions/${sessionId}/messages`,
      prepareSendMessagesRequest({ messages: outgoing }) {
        const latest = outgoing.at(-1);
        const text = latest === undefined ? "" : textFrom(latest);
        return { body: { turnId: crypto.randomUUID(), text } };
      },
    }),
  });
  const [input, setInput] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const canSend = historyReady && status !== "submitted" && status !== "streaming";

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/chat/sessions/${sessionId}/messages`)
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as HistoryBody;
        if (cancelled) return;
        setMessages(historyMessages(body));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHistoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, setMessages]);

  return (
    <ChatLayout
      messages={messages}
      sessionId={sessionId}
      canSend={canSend}
      input={input}
      onInput={setInput}
      onSubmit={() => {
        const text = input.trim();
        if (text === "" || !canSend) return;
        setInput("");
        void sendMessage({ text });
      }}
    />
  );
}

function ChatLayout({
  messages,
  sessionId,
  canSend,
  notice,
  input = "",
  onInput,
  onSubmit,
}: {
  messages: readonly ChatMessage[];
  sessionId: string | null;
  canSend: boolean;
  notice?: string;
  input?: string;
  onInput?: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <ChatShell>
      <ChatCard>
        <ChatHeading />
        <ChatTranscript>
          {notice === undefined ? null : <p className="text-sm text-muted">{notice}</p>}
          {messages.length === 0 ? <p className="text-sm text-muted">Ask about an order, a product, or a person.</p> : null}
          {messages.map((message) => {
            const proposal = proposalOf(message);
            return (
              <div key={message.id}>
                <p className="whitespace-pre-wrap text-sm">
                  {message.role === "user" ? "You" : "Assistant"}
                  {": "}
                  {textFrom(message)}
                </p>
                {proposal === undefined || sessionId === null ? null : (
                  <HandoffCard key={`${proposal.id}:${proposal.decision}`} proposal={proposal} sessionId={sessionId} />
                )}
              </div>
            );
          })}
        </ChatTranscript>
        <ChatComposer input={input} canSend={canSend} onInput={onInput} onSubmit={onSubmit} />
      </ChatCard>
    </ChatShell>
  );
}

function proposalOf(message: ChatMessage): Proposal | undefined {
  const part = message.parts.find((candidate) => candidate.type === "data-proposal");
  if (part === undefined || part.type !== "data-proposal") return undefined;
  return part.data;
}

function textFrom(message: ChatMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function historyMessages(body: HistoryBody): ChatMessage[] {
  const proposalsByTurn = new Map(body.proposals.map((proposal) => [String(proposal.turnId), proposal]));
  return [...body.messages]
    .sort((left, right) => left.sequence - right.sequence)
    .map((message) => {
      const proposal = message.role === "assistant" ? proposalsByTurn.get(message.turnId) : undefined;
      const parts: ChatMessage["parts"] = [{ type: "text", text: message.content }];
      if (proposal !== undefined) {
        parts.push({ type: "data-proposal", data: proposal });
      }
      return {
        id: `${message.turnId}:${message.role}`,
        role: message.role === "customer" ? "user" : "assistant",
        parts,
      };
    });
}

function subscribeSession(): () => void {
  return () => undefined;
}

function readSession(): string | null {
  return sessionStorage.getItem(sessionKey);
}

async function startSession(
  setSessionId: (sessionId: string) => void,
  setFailed: (failed: boolean) => void,
): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timezone }),
  });
  if (!response.ok) {
    setFailed(true);
    return;
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string") {
    setFailed(true);
    return;
  }
  sessionStorage.setItem(sessionKey, body.id);
  setSessionId(body.id);
}
