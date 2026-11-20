"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChatCard } from "./chat/chat-card";
import { ChatHeading } from "./chat/chat-heading";
import { ChatShell } from "./chat/chat-shell";
import { resolveTabSession, sessionPath, type SessionResolution } from "./session-entry";

export function SessionRedirect() {
  const router = useRouter();
  const pending = useRef<Promise<SessionResolution> | null>(null);
  const [resolution, setResolution] = useState<SessionResolution | null>(null);

  useEffect(() => {
    if (pending.current === null) pending.current = resolveTabSession();
    const inFlight = pending.current;
    let cancelled = false;
    void inFlight.then((result) => {
      if (cancelled) return;
      setResolution(result);
      switch (result.kind) {
        case "resolved":
          router.replace(sessionPath(result.sessionId));
          return;
        case "failed":
          return;
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <ChatShell>
      <ChatCard>
        <ChatHeading />
        <p className="text-sm text-muted">{noticeFor(resolution)}</p>
      </ChatCard>
    </ChatShell>
  );
}

function noticeFor(resolution: SessionResolution | null): string {
  if (resolution === null) return "Opening chat...";
  switch (resolution.kind) {
    case "resolved":
      return "Opening chat...";
    case "failed":
      return "The chat session could not be started.";
    default: {
      const exhaustive: never = resolution;
      return exhaustive;
    }
  }
}
