"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import type { Proposal } from "../domain/handoff";
import type { CustomerToolCard } from "../service/tool/customer-tool-cards";
import { ChatCard } from "./chat/chat-card";
import { ChatComposer } from "./chat/chat-composer";
import { ChatHeading } from "./chat/chat-heading";
import { ChatShell } from "./chat/chat-shell";
import { ChatTranscript } from "./chat/chat-transcript";
import { sendAllowed } from "./chat/send-allowed";
import { historyMessages, type ChatMessage, type HistoryBody } from "./history-messages";

const HandoffCard = dynamic(() => import("./handoff-card").then((mod) => mod.HandoffCard), { ssr: false });
const ToolCards = dynamic(() => import("./tool-cards").then((mod) => mod.ToolCards), { ssr: false });

export function ChatPanel({ sessionId }: { sessionId: string }) {
  return <ChatThread sessionId={sessionId} />;
}

function ChatThread({
  sessionId,
}: {
  sessionId: string;
}) {
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
  const canSend = sendAllowed({ failed: false, restoreHistory: true, historyReady, status });

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
  input = "",
  onInput,
  onSubmit,
}: {
  messages: readonly ChatMessage[];
  sessionId: string;
  canSend: boolean;
  input?: string;
  onInput?: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <ChatShell>
      <ChatCard>
        <ChatHeading />
        <ChatTranscript>
          {messages.length === 0 ? <p className="text-sm text-muted">Ask about an order, a product, or a person.</p> : null}
          {messages.map((message) => {
            const cards = toolCardsOf(message);
            const proposal = proposalOf(message);
            const align = message.role === "user" ? "end" : "start";
            return (
              <div key={message.id} className="flex w-full flex-col gap-2">
                <Bubble align={align} variant={align === "end" ? "default" : "outline"}>
                  <BubbleContent className="whitespace-pre-wrap">
                    <span className="sr-only">{align === "end" ? "You" : "Assistant"}: </span>
                    {textFrom(message)}
                  </BubbleContent>
                </Bubble>
                {cards === undefined ? null : (
                  <div className="w-full max-w-[80%] self-start">
                    <ToolCards cards={cards} />
                  </div>
                )}
                {proposal === undefined ? null : (
                  <div className="w-full max-w-[80%] self-start">
                    <HandoffCard
                      key={`${proposal.id}:${proposal.decision}`}
                      proposal={proposal}
                      sessionId={sessionId}
                    />
                  </div>
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

function toolCardsOf(message: ChatMessage): CustomerToolCard[] | undefined {
  const part = message.parts.find((candidate) => candidate.type === "data-tool-cards");
  if (part === undefined || part.type !== "data-tool-cards") return undefined;
  return part.data;
}

function textFrom(message: ChatMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}
