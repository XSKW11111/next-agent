# LangSmith trace coverage

This inventory covers a new support turn sent through `submitTracedTurn`. It describes metrics available from the current request path, tool runner, and OpenRouter response. Provider values are recorded only when OpenRouter supplies valid numbers. The app does not estimate missing usage or cost.

## Recorded fields

| Metric or event | Source | LangSmith location | Status |
| --- | --- | --- | --- |
| Turn start, end, duration, completion or error | `support-turn` lifecycle | Root run timestamps and error | Implemented. LangSmith computes duration from timestamps. |
| Customer and assistant persistence, prior context, support graph durations | `logStep` around each server phase | Root `extra.stepTimingsMs` | Implemented. These are phase times, not browser latency. |
| Model chat and summary calls | OpenRouter adapter | `llm` children named `chat-completion` or `summarize` | Implemented with start, end, outcome, and resolved model name when supplied. Failed calls set a generic LangSmith error. |
| Embedding calls | OpenRouter embedder | `llm` child named `embed-query`, nested below the executing tool | Implemented with start, end, outcome, and model name. The `llm` type lets LangSmith include embedding usage in trace totals. |
| Executed tool calls | `runSupportTool` boundary | `tool` children with tool name, generated trace call ID, start, end, and success, unavailable, or error outcome | Implemented. One child represents one execution. Failed calls set a generic LangSmith error; an unavailable business outcome stays distinct. |
| Model, embedding, executed tool, skipped tool counts and outcome counts | Observations and completed turn | Root `extra.modelCalls`, `embeddingCalls`, `toolCalls`, `skippedToolCalls`, `toolOutcomes`, `providerOutcomes` | Implemented. `skippedToolCalls` is absent if the turn fails before completion. |
| Input, output, and total tokens | OpenRouter `usage.prompt_tokens`, `completion_tokens`, `total_tokens` | Child `outputs.usage_metadata`; root `extra.observedUsage` | Implemented when supplied. LangSmith also rolls child tokens into the root total. |
| Cache read and cache creation tokens | OpenRouter `usage.prompt_tokens_details` | Child `usage_metadata.input_token_details.cache_read` and `cache_creation`; root `extra.observedUsage` | Implemented when supplied. |
| Reasoning, audio, image, and video token details | OpenRouter prompt and completion token details | Child `usage_metadata.input_token_details` or `output_token_details`; root `extra.observedUsage` | Implemented for the named numeric fields when supplied. The current chat path sends text, so media counts are normally absent. |
| Billed USD total cost | OpenRouter `usage.cost` | Child `usage_metadata.total_cost`; root `extra.observedUsage.totalCost` | Implemented when supplied. LangSmith also rolls child cost into the root total. |
| Usage and trace completeness | Provider responses and child write results | Child `extra.metadata.usageReported`, `costReported`; root `extra.tokenUsageComplete`, `costUsageComplete`, `observationFailures` | Implemented. A partial `observedUsage` sum is not a complete bill. |
| Existing support trace facts | Turn input and output projection | Root inputs and outputs | Customer sentence, prior turns, assistant line, tool results, waiting calls, and chunk plans remain available. |

## Verification on 2026-10-18

- The full in-memory suite passed 199 tests in 45 files. It covers nested tool and embedding spans, concurrent child writes, partial provider usage parsing, generic child errors, trace-safe child payloads, and partial root totals.
- A synthetic trace sent through `createTurnTracingSession` and `createLangSmithRunsPort` was read back from the `next-agent-debug` LangSmith project. Run `720f881c-9fce-4266-96fa-6ebcad472ba1` has two top-level children, one nested embedding child, 16 aggregate tokens, and $0.00000553 aggregate cost. Its root `observedUsage` includes two cached input tokens, one cache creation token, and one reasoning output token. This verifies the SDK write and readback path with known synthetic usage values.
- A separate synthetic LangSmith child `ba8dc057-7e80-455c-9dfe-af9c1b19dfa4` read back with `error: "model call failed"` and `status: "error"`. This verifies the generic error field used for failed metric spans.
- A local HTTP app-route check at commit `bc07636` created a session, sent a synthetic backpack search turn, and read the saved reply through GET history. LangSmith root `7404d289-3ad4-4668-a042-3b4725b10e38` in `next-agent-debug` recorded four provider calls, including three model calls and one nested embedding call, plus two executed tools. It recorded zero skipped calls and zero child write failures. Token and cost completeness were true. LangSmith reported 4062 aggregate tokens and $0.00041411 aggregate cost; the nested embedding recorded three tokens and $0.00000006. This verifies the local HTTP route and real provider path. Browser UI behavior remains unverified.
- Vercel Preview could not run this check because that environment lacks `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT`. Production verification of this PR remains pending. The prior deployed revision does not prove these new child fields.

## Limits

- `totalTokens` and `totalCost` are complete only when every provider call reported the respective value and all child writes succeeded. A missing value stays absent. `tokenUsageComplete` and `costUsageComplete` signal this boundary.
- The app does not stream model responses, so it cannot report time to first token. It does not measure browser click latency, individual Supabase queries, CPU, memory, or network byte counts in LangSmith.
- OpenRouter does not supply a reliable per-call input and output billed cost split in the chat response used here. The app records the supplied total cost and does not derive a split from list prices. It does not label upstream inference cost as billed spend.
- New child metric fields omit prompts, customer text, tool arguments, tool results, raw model tool IDs, and secrets. The pre-existing root trace contains customer context and tool result payloads. LangSmith access and retention must account for that data.

The [OpenRouter chat API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request) supplies the response usage object. [OpenRouter cache usage](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/) defines cache read and write fields. [LangSmith LLM trace guidance](https://docs.langchain.com/langsmith/log-llm-trace) defines the standard token and cost metadata used by the child runs.
