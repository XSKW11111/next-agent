# Inspect saved debug turns

The operator opens `/debug/turns` to inspect saved customer sends, server latency, replies, and optional trace detail from this checkout's local observability store.

## Sub-features

- `debug-list` shows a receipt for a completed browser send.
- `debug-detail` shows the matching reply, server latency, sink, and trace state.
- `debug-trace` shows a root trace and step timings when `NEXT_AGENT_DEBUG_TRACE=true` for that server.

## How to get to it (user POV)

- After a customer send, open `http://127.0.0.1:<port>/debug/turns` and select that send from Saved sends.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- A browser send completed against this isolated server. Record its exact prompt, session id, and turn id from history.
- `debug-trace` additionally requires a server launched with `NEXT_AGENT_DEBUG_TRACE=true`.

- **Open the viewer.** Go to `/debug/turns`. Require the `Debug turns` heading and a Saved sends entry with the exact test prompt.
- **Select the receipt.** Choose that entry. The Detail section shows the matching reply, a nonnegative server latency, the sink, and either `null (tracing off for this send)` or the trace projection. Compare the reply to the transcript and history, and the latency to the matching receipt from `GET /api/debug/turns`.
- **Inspect tracing when enabled.** Select a turn sent with tracing enabled. Confirm the detail route's root trace belongs to the same turn and inspect fields with [observability checks](../references/observability.md). A latency-only receipt does not pass `debug-trace`.
- **Proof.** Save list and detail accessibility snapshots, screenshots, and redacted list/detail JSON under `evidence/debug-turns/`. Record the turn id, sink, `hasTrace`, and revision.

## Gotchas

- The viewer reads this checkout's `.data/observability`; another server or deleted store will not show the turn.
- `GET /api/debug/turns` and its detail route currently have no authentication check. Use only synthetic customer text in verification and report this exposure as a product security gap. Do not put real customer data into proof files.
- With tracing off, `Step timings` can be `{}` and `Trace` is null. That passes latency receipt inspection, not trace verification.
