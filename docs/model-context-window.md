# Model context window

## Problem

Short-term memory compaction uses a token window and a send ceiling. Those values are independent env knobs (`CONTEXT_WINDOW_TOKENS`, `CONTEXT_HARD_TOKENS`) with code defaults of 128,000, 120,000, and a 256,000 fallback inside `compactHistory`. They do not follow `AI_MODEL`.

Live traffic uses DeepSeek through OpenRouter. OpenRouter publishes per-model `context_length` (and a provider copy). The window must come from that metadata so a slug change cannot keep a stale 128k, and so a V4 1M card is not ignored. There is no separate product hard cap.

## Usage from the caller's view

Process initialization loads `AI_MODEL` and `OPENROUTER_API_KEY`, then fetches OpenRouter model metadata once and caches the resolved budgets for the process. Chat turns do not look up the model again. Operators set `AI_MODEL`. They do not set a context window or a hard-cap env var.

`.env.example` uses `AI_MODEL=deepseek/deepseek-chat`. Production may use any OpenRouter slug; the same lookup applies.

## Current path and boundaries

`parseAgentConfig` requires `CONTEXT_WINDOW_TOKENS` and optionally `CONTEXT_HARD_TOKENS` (default 120,000), and rejects a hard cap that is not strictly below the window. `runSupportTurn` passes those numbers into `compactHistory`. Compaction starts at 70% of `min(window, hard cap)`. The OpenRouter adapter counts `JSON.stringify({ messages, tools })` with cl100k_base and refuses a body over the hard cap. `summarize` uses `max_tokens: 20_000`. `summaryReserveTokens` is 20,000.

This spec replaces the window and hard-cap knobs. It does not change stored message roles, the rolling summary headings, tool-round limits, or the cl100k counter.

## Resolve once at process init

Call:

```http
GET https://openrouter.ai/api/v1/model/{author}/{slug}
Authorization: Bearer <OPENROUTER_API_KEY>
```

`{author}/{slug}` is `AI_MODEL` (OpenRouter variant suffixes such as `:free` stay on the slug).

On network error or non-200: retry three times after the first try (four attempts total) with backoff 200ms, 400ms, 800ms. If every attempt fails, the resolved window is 128,000.

A 200 body is not retried for missing fields.

Cold start on a serverless instance is process init.

## Resolved window

From a 200 payload, in order:

1. `data.context_length` when it is a positive integer.
2. Else `data.top_provider.context_length` when it is a positive integer.
3. Else 128,000.

Do not take the min of those two fields. Do not invent a third source. A 200 that has neither length uses 128,000 and the default 20,000 output reserve; it does not keep a lone `max_completion_tokens`.

A non-positive length is unusable and does not count as a window.

## Output reserve and tokenizer slack

Output reserve:

- `min(data.top_provider.max_completion_tokens, 20_000)` when `max_completion_tokens` is a positive integer.
- Else 20,000.

Tokenizer slack is 8,000 tokens. Counting stays cl100k_base. The slack is measurement margin against DeepSeek's tokenizer, not a product cap.

## Send ceiling

```text
ceiling = window − outputReserve − 8000
```

If that value is ≤ 0, drop the 8,000 slack and recompute. If it is still ≤ 0, drop the reserve (reserve becomes 0) and recompute. If the window itself is unusable, use the 128,000 fallback and recompute reserve and slack from that fallback (fallback has no provider `max_completion_tokens`, so reserve is 20,000).

The assembled OpenRouter body must stay at or under the ceiling. Compaction starts when the counted request exceeds **70% of the ceiling**. The last customer message is never dropped. A last customer message that cannot fit the ceiling is a reject (`ContextSummaryRejected` / `ContextBudgetExceeded`).

There is no `CONTEXT_HARD_TOKENS` and no 120,000 default send cap. The 256,000 `compactHistory` window default is removed. Turns use the process-resolved ceiling.

## Worked numbers

`deepseek/deepseek-chat` today: `context_length` 163,840, `max_completion_tokens` 16,000.

```text
window   = 163840
reserve  = min(16000, 20000) = 16000
ceiling  = 163840 − 16000 − 8000 = 139840
start    = floor(139840 × 0.7) = 97888
```

Fetch failed, 128,000 fallback:

```text
window   = 128000
reserve  = 20000
ceiling  = 128000 − 20000 − 8000 = 100000
start    = floor(100000 × 0.7) = 70000
```

## Config surface

Delete `CONTEXT_WINDOW_TOKENS` and `CONTEXT_HARD_TOKENS` from the env schema, `.env.example`, and tests. Keep `AI_MODEL` and `OPENROUTER_API_KEY` required.

Initialization that parses agent config must complete the models lookup (or finish retries and fall back) before serving turns. Tests mock `GET /api/v1/model/{author}/{slug}` instead of passing a window integer through config.

## Out of scope

- Changing the live `AI_MODEL` slug beyond what env already sets.
- Per-turn metadata refresh.
- Replacing cl100k_base with a DeepSeek tokenizer.
- Subtracting an uncapped provider `max_completion_tokens` (v3.2 reports 147,456).
- A product hard cap that is independent of the model window.
