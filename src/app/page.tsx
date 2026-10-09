"use client";

import { DefaultChatTransport, type ChatStatus, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { loadChatSession } from "./chat-session";

type SessionLoad = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; sessionId: string };

export default function Page() {
  const [load, setLoad] = useState<SessionLoad>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadChatSession({
      storage: sessionStorage,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      request: requestSession,
    })
      .then((sessionId) => {
        if (!cancelled) setLoad({ kind: "ready", sessionId });
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
      <h1>Support</h1>
      <SessionGate load={load} />
    </main>
  );
}

function SessionGate({ load }: { load: SessionLoad }) {
  switch (load.kind) {
    case "loading":
      return <p>Starting</p>;
    case "failed":
      return <p>The chat could not start.</p>;
    case "ready":
      return <SupportChat sessionId={load.sessionId} />;
    default: {
      const unexpected: never = load;
      return unexpected;
    }
  }
}

function SupportChat({ sessionId }: { sessionId: string }) {
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
  const { messages, sendMessage, status } = useChat({ transport });
  const [draft, setDraft] = useState("");
  const activity = activityLabel(status);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft;
    setDraft("");
    void sendMessage({ text });
  }

  return (
    <>
      <ol>
        {messages.map((message) => (
          <li key={message.id}>
            <span className="speaker">{speaker(message.role)}</span>
            {message.parts.map((part, index) =>
              part.type === "text" ? <span key={index}>{part.text}</span> : null,
            )}
          </li>
        ))}
      </ol>
      {activity === undefined ? null : <p>{activity}</p>}
      <form onSubmit={onSubmit}>
        <label>
          Message
          <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button type="submit" disabled={status !== "ready"}>
          Send
        </button>
      </form>
    </>
  );
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

function lastUserText(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") continue;
    return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  }
  return "";
}

function speaker(role: UIMessage["role"]): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Support";
    case "system":
      return "System";
    default: {
      const unexpected: never = role;
      return unexpected;
    }
  }
}

function activityLabel(status: ChatStatus): string | undefined {
  switch (status) {
    case "submitted":
      return "Sending";
    case "streaming":
      return "Receiving";
    case "ready":
    case "error":
      return undefined;
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}
