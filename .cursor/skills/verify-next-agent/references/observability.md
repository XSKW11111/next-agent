# Observability checks

Use these checks with the feature recipe for the same browser turn. Keep the tested revision, session id, turn id, synthetic prompt, model name, and run mode with the evidence. Do not save keys or service-role credentials.

## Latency of a customer send

1. Open the page before timing so the first Next.js page compilation is not counted as send latency. Record whether the server and model are cold or warm.
2. Start a monotonic timer immediately before choosing `Send`. Capture the first visible assistant text and final reply with `Send` enabled. Record click-to-first-visible-text and click-to-complete in milliseconds, including browser-driver observation delay. If the driver cannot observe first text reliably, use `null`; do not substitute total time.
3. Save the matching `POST /api/chat/sessions/<session-id>/messages ... in <ms>` line from this run's `server.log`, with its HTTP status. This is server request time, not browser-visible latency. Compare it with the same turn's local receipt in `GET /api/debug/turns`.
4. Save `evidence/latency.json` with revision, session/turn id, prompt, model name, run mode, cold/warm state, measurement method, observed times, server request time, and status. Use `null` for unavailable measurements.

A successful send with valid, nonnegative measurements passes the measurement check. There is no customer latency target here; do not invent an SLA or call one sample a p95. A regression claim needs repeated comparable runs on pinned revisions.

## Tracing

1. Inspect `src/app/api/chat/sessions/[id]/messages/route.ts` in the tested checkout. The browser route chooses `submitTracedTurn` when `NEXT_AGENT_DEBUG_TRACE=true`; otherwise it uses `submitTurn`. Record the actual flag and sink for this process. `NEXT_AGENT_DEBUG_TRACE=true` with LangSmith key and project uses LangSmith; without them it uses the local sink. Keys are not required for a local root trace.
2. Run `npm test -- src/service/turn/submit-traced-turn.test.ts src/infra/debug-runtime.test.ts src/infra/langsmith/debug-trace-config.test.ts` for the trace contract. Save the command and result under `evidence/tracing/contract.txt`. A unit pass does not prove the browser route.
3. For live route proof, send one synthetic turn through the page on the traced server. `GET /api/debug/turns` must return a receipt for its turn id with `hasTrace: true`; `GET /api/debug/turns/<receipt-id>` must include the root trace. The `/debug/turns` viewer must show the same turn and trace. A 200 chat POST alone does not prove tracing.
4. Inspect the root trace: `input.currentSentence` matches the prompt; `input.priorTurns` contains only completed earlier turns; `input.timezone` is resolved or explicitly unresolved; `output.assistantLine` matches the stored reply; tool results, waiting calls, and chunk plans match what ran; `stepTimingsMs` has finite, nonnegative values for `insert-customer`, `prior-context`, `support-graph`, and `insert-assistant`. Tool-free turns legitimately have empty tool arrays. Confirm one root for one new turn and no second root on a same-turn retry. Check redaction without printing secrets.
5. Save a redacted receipt and trace detail under `evidence/tracing/`. Distinguish **browser route**, **in-memory contract**, and **external LangSmith delivery** in the verdict. Local receipt proof does not establish LangSmith delivery; a LangSmith URL alone does not prove trace fields.
