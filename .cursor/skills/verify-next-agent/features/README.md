# next-agent verification map

This directory is the maintained source for verifying the support chat. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- `APP_ROOT` contains `src/app/chat-panel.tsx`.
- Launch with `.cursor/skills/verify-next-agent/launch.sh` and keep the printed evidence directory.
- The server listens on `http://127.0.0.1:4173` unless `VERIFY_PORT` was set.
- Run `doctor.sh` on that evidence directory and require `ok`.
- Use a browser origin that this run opened. Do not reuse a tab whose port belongs to another server.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from a fresh browser origin unless its preconditions say the session already exists. On that fresh origin, `Send` is enabled while the empty prompt is the only transcript text. A disabled `Send` there fails Open the support chat. History may delay `Send` only when Resume a session reloads an id that was already stored.
- Prefer the accessible names `Support chat`, `Message`, and `Send`.
- Treat every command as literal.
- Browser actions go through the page. History checks use `GET /api/chat/sessions/<id>/messages` after the page has stored `next-agent-session-id`.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the customer action and the resulting transcript, not only the final screen.
- UI proof includes an accessibility snapshot and a screenshot that show `Support chat`.
- A sent message also needs the history JSON for that session id.
- Each send records latency and a tracing verdict using [observability checks](../references/observability.md). A missing debug trace is not a passing trace check.
- Record the feature id with every artifact.
- Report an unreachable path with the attempted step and the unmet precondition. Mark a path untested when its trigger did not occur in this run.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact step and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Open the support chat](./open-chat.md) covers the first visit and the empty transcript.
- [Send a message](./send-message.md) covers typing, submit, the streamed reply, the stored turn, and a reply that asks for more than 8 tool calls.
- [Resume a session](./resume-session.md) covers reload on the same origin and a different origin.
- [Look up an order](./lookup-order.md) covers `lookup_order` for `#W002`.
- [Recommend a product](./search-products.md) covers `search_products`.
- [Claim the early risers promotion](./claim-promotion.md) covers `claim_early_risers`.
- [Confirm or cancel a handoff](./handoff-card.md) covers `capture_handoff` and the Confirm and Cancel card. The card stays unreachable until a turn returns `data-proposal`.
- [Inspect saved debug turns](./debug-turns.md) covers the operator viewer at `/debug/turns`, including latency receipts and optional trace detail.
