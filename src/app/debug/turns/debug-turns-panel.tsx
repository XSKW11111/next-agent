"use client";

import { useEffect, useState } from "react";
import type { TurnObservabilityRecord, TurnObservabilitySummary } from "@/domain/turn-observability";

export function DebugTurnsPanel() {
  const [turns, setTurns] = useState<readonly TurnObservabilitySummary[]>([]);
  const [selected, setSelected] = useState<TurnObservabilityRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadList(setTurns, setError);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Debug turns</h1>
        <p className="text-sm text-muted-foreground">
          Local latency and trace receipts saved under `.data/observability`. Works without LangSmith.
        </p>
      </header>

      {error !== null ? <p className="text-sm text-red-700">{error}</p> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Saved sends</h2>
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No turns saved yet. Send a chat message first.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {turns.map((turn) => (
              <li key={turn.id}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-muted/40"
                  onClick={() => void loadOne(turn.id, setSelected, setError)}
                >
                  <span className="font-medium">{turn.currentSentence}</span>
                  <span className="text-xs text-muted-foreground">
                    {turn.savedAt} · {turn.serverLatencyMs} ms server ·{" "}
                    {turn.hasTrace ? "trace saved" : "latency only"} · {turn.sink}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected !== null ? (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="text-lg font-medium">Detail</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Server latency</dt>
              <dd>{selected.serverLatencyMs} ms</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sink</dt>
              <dd>{selected.sink}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Step timings</dt>
              <dd>
                <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-xs">
                  {JSON.stringify(selected.stepTimingsMs, null, 2)}
                </pre>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Reply</dt>
              <dd className="mt-1 whitespace-pre-wrap">{selected.reply}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Trace</dt>
              <dd>
                <pre className="mt-1 max-h-96 overflow-auto rounded bg-muted/50 p-2 text-xs">
                  {selected.trace === null
                    ? "null (tracing off for this send)"
                    : JSON.stringify(selected.trace, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </main>
  );
}

async function loadList(
  setTurns: (turns: readonly TurnObservabilitySummary[]) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  try {
    const response = await fetch("/api/debug/turns");
    if (!response.ok) throw new Error(`list failed (${response.status})`);
    const body = (await response.json()) as { turns: TurnObservabilitySummary[] };
    setTurns(body.turns);
    setError(null);
  } catch (error) {
    setError(error instanceof Error ? error.message : "list failed");
  }
}

async function loadOne(
  id: string,
  setSelected: (record: TurnObservabilityRecord | null) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  try {
    const response = await fetch(`/api/debug/turns/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`detail failed (${response.status})`);
    setSelected((await response.json()) as TurnObservabilityRecord);
    setError(null);
  } catch (error) {
    setError(error instanceof Error ? error.message : "detail failed");
  }
}
