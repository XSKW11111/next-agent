import { runLiveCases } from "../src/service/eval/live-cases.ts";

const baseUrl = process.env.LIVE_EVAL_BASE ?? "http://127.0.0.1:3000";

const report = await runLiveCases(async (turns) => {
  const created = await fetch(`${baseUrl}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timezone: "Asia/Shanghai" }),
  });
  const session = (await created.json()) as { id?: string };
  if (session.id === undefined) throw new Error("session create failed");
  const replies: string[] = [];
  for (const text of turns) {
    const response = await fetch(`${baseUrl}/api/chat/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnId: crypto.randomUUID(), text }),
    });
    replies.push(textFrom(await response.text()));
  }
  return replies;
});

console.log(JSON.stringify(report, null, 2));

function textFrom(sse: string): string {
  const parts: string[] = [];
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6);
    if (raw === "[DONE]") continue;
    const event = JSON.parse(raw) as { type?: string; delta?: string };
    if (event.type === "text-delta" && event.delta !== undefined) parts.push(event.delta);
  }
  return parts.join("");
}
