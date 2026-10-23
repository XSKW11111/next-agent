"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function Page() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const startRequest = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (startRequest.current === null) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      startRequest.current = fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone }),
      }).then(async (response) => {
        if (!response.ok) throw new Error("session start failed");
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null || !("id" in body) || typeof body.id !== "string") {
          throw new Error("invalid session response");
        }
        return body.id;
      });
    }
    void startRequest.current.then((id) => {
      if (!cancelled) router.replace(`/chat/${id}`);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [router]);

  return <main>{failed ? "The chat session could not be started. Reload to try again." : "Starting chat…"}</main>;
}
