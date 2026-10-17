# Observability checks

Use the same synthetic browser turn for latency and LangSmith checks. Keep the tested revision, deployment or server origin, session id, turn id, prompt, model, and UTC send time. Never save API keys or private customer data.

## Latency of a customer send

1. Open the page before timing so the first page compilation is excluded. Record whether the server and model are cold or warm.
2. Start a monotonic timer immediately before choosing `Send`. Record click-to-first-visible-text and click-to-complete in milliseconds. Use `null` when first text cannot be observed reliably.
3. Save the matching server request time from `server.log` for local runs or Vercel request records for deployed runs. This request time differs from browser-visible latency.
4. Save `evidence/latency.json` with revision, session and turn ids, model, run mode, cold/warm state, method, observed times, request time, and status. Use `null` for unavailable measurements. Do not invent an SLA or call one sample a p95.

## LangSmith tracing

1. Confirm `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT` are configured for the tested server without printing their values. The message route always calls `submitTracedTurn` for a new turn. Missing configuration is a failure, not a local fallback.
2. Run `npm test -- src/service/turn/submit-traced-turn.test.ts src/infra/debug-runtime.test.ts src/infra/langsmith/trace-config.test.ts` and save the result under `evidence/tracing/contract.txt`. A unit pass does not prove external delivery.
3. Send one synthetic turn through the page. In the configured LangSmith project, find its `support-turn` root run by UTC time and `extra.sessionId` plus `extra.turnId`. Read back the root run. A successful chat POST alone does not prove LangSmith received it. If the run has not appeared, retry readback for a bounded interval and mark it unverified if still absent.
4. Compare `inputs.currentSentence` with the sent prompt; `inputs.priorTurns` with completed earlier turns; `outputs.assistantLine` with the stored reply; and tool results, waiting calls, and chunk plans with the observed path. Confirm `extra.stepTimingsMs` contains finite, nonnegative `insert-customer`, `prior-context`, `support-graph`, and `insert-assistant` values. Tool-free turns have empty tool arrays. A same-turn retry should not create another root run.
5. Save a redacted readback under `evidence/tracing/` and state separately whether the browser route, in-memory contract, and external LangSmith delivery passed. LangSmith root duration and step timings describe server work within the run; browser click-to-complete also includes transport and rendering. Optional terminal observations use `NEXT_AGENT_TERMINAL_OBSERVABILITY=true` outside production and print only IDs and latency metadata. Production always suppresses them.
