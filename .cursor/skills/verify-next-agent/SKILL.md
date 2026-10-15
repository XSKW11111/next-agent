---
name: verify-next-agent
description: Verify the next-agent support chat in a browser, including sends, stored history, tracing, and latency. Use for support-page or debug-turn verification.
---

# Verify next-agent

next-agent's customer surface is the support chat in the browser. A customer opens the page, types a message, and reads the reply. Operators can inspect saved latency and trace receipts at `/debug/turns`. The checkout also serves JSON routes for health, session create, history, handoff decisions, and debug receipts.

The page that only renders the text `next-agent` is not this surface. Drive a checkout whose `src/app/chat-panel.tsx` exists.

## Launch

From the repo that contains this skill:

```bash
chmod +x .cursor/skills/verify-next-agent/*.sh
APP_ROOT=<checkout with the support chat> \
  .cursor/skills/verify-next-agent/launch.sh
```

`APP_ROOT` defaults to this skill's repo root. Set it when that root has no support chat page. The script prints one evidence directory, `/tmp/next-agent-verify/<run-id>`. Keep that path. It holds `server.pid`, `server.log`, `port`, `root`, `revision` (the checked-out commit), and the `evidence/` proof files. Use a new `RUN_ID` for each run.

The server is `npx next dev --hostname 127.0.0.1 --port 4173` inside a disposable git worktree named `next-agent-verify-<run-id>` next to `APP_ROOT`. Launch runs `npm ci` there and, when present, copies `APP_ROOT/.env` to that checkout's ignored `.env.local` with owner-only permissions. Cleanup removes the checkout. `VERIFY_PORT` overrides the port. One checkout cannot run two `next dev` processes, and Turbopack will not follow a `node_modules` symlink out of that checkout. The extra worktree keeps verification off the user's server. It is ready when `GET http://127.0.0.1:<port>/api/health` returns `{"ok":true}`. Health does not prove that the model or hosted data services are reachable. Two runs need two ports and two evidence directories. Hosted sessions and messages can be shared across processes; browser `sessionStorage` and in-memory handoff state are per origin/process.

Tear down with `cleanup.sh` and the same evidence directory. Do not start a second server on a port this run already owns.

## Doctor

```bash
.cursor/skills/verify-next-agent/doctor.sh /tmp/next-agent-verify/<run-id>
```

The check is read-only. It passes only when the recorded pid is alive, health returns `{"ok":true}`, the server log names `127.0.0.1:<port>`, and the recorded root still has the support chat page. If it fails, do not drive the page.

## Drive

Choose the feature IDs that exercise the PR's changes. A baseline chat send alone verifies baseline chat, not evaluation, tracing, or overflow behavior. Use a browser against `http://127.0.0.1:<port>/`. Prefer the accessible names below. Do not click by coordinates.

For every sent turn, follow [the observability checks](references/observability.md): record browser-visible latency from the same send, inspect the matching server request timing, and check whether the selected route is traced. A debug trace requires a separate trace receipt; a passing chat POST or trace unit test does not prove one exists. These checks reuse the send instead of starting a costly evaluation suite.

- Heading `Support chat`.
- Textbox named `Message`.
- Button named `Send`. The label stays `Send` while a reply is in flight. The form ignores a second submit until that reply finishes.
- The transcript lines start with `You` or `Assistant`.
- First visit with an empty `sessionStorage` shows `Ask about an order, a product, or a person.` `Send` is enabled on that screen. A new chat has no history, so do not wait for a history response before treating `Send` as available. A disabled `Send` while that empty prompt is the only transcript text is a failure.
- After the page stores `next-agent-session-id` and the transcript is still empty, `Send` stays enabled. The history request is only for a reload that already had the id in `sessionStorage`.
- A failed session create shows `The chat session could not be started.` and disables `Send`. The textbox `Message` is still there.
- A failed send leaves the customer line without an assistant line. The page has no separate failure sentence.
- More than 8 tool calls in one model reply must not fail the send. The turn runs calls in ordered chunks of at most 8, within its configured round budget; the POST stays 200 and the transcript gains an `Assistant` line based on the results. If calls exceed the budget, the reply names the checks not run. The old `I can only check a few things at once...` refusal or a 500 is a failure on this PR. Prove the chunk behavior only when the model actually returns more than 8 calls; otherwise mark it untested.

The browser stores the session id in `sessionStorage` under `next-agent-session-id`. After a send, read that id and confirm the row with `GET /api/chat/sessions/<id>/messages`. The JSON `messages` array must contain the customer `content` and the assistant `content`.

The assistant text is the model reply. Do not require one fixed sentence.

The model tools to exercise after `Send` is enabled are `lookup_order`, `search_products`, `claim_early_risers`, and `capture_handoff`. Each one has a feature file. A tool feature is unreachable when `OPENROUTER_API_KEY`/`AI_MODEL` is missing or `POST https://openrouter.ai/api/v1/chat/completions` does not return a completion. Record that precondition. Do not prove a tool by calling the database yourself.

A pending handoff renders an A2UI card from `src/app/handoff-card.tsx` with Confirm and Cancel. That card appears only after a turn returns `data-proposal`. Do not invent the card when the transcript has no proposal.

## Evidence

Write proof under `/tmp/next-agent-verify/<run-id>/evidence/`. Cleanup must not delete that directory.

For a UI proof, save the browser state after opening, after the customer clicks `Send`, and after the reply. Save a final accessibility snapshot and screenshot that show `Support chat`, the customer text, and the reply, plus the history JSON from the GET above. Record the browser session id, request status, `revision`, latency observations, and trace verdict with the proof. These link the action, rendered result, stored turn, and tested commit.

Do not prove the chat by calling test-only setters. `POST /api/chat/sessions` and the message route are the same routes the page calls. A curl of those routes can confirm a side effect after the browser send. A curl that never uses the page does not prove the page.

## Cleanup

```bash
.cursor/skills/verify-next-agent/cleanup.sh /tmp/next-agent-verify/<run-id>
```

The script signals the process group recorded at launch. It does not kill every `next` or `node` process. It leaves `/tmp/next-agent-verify/<run-id>` in place, including `evidence/`.

## Helpers

- `.cursor/skills/verify-next-agent/launch.sh` starts one isolated dev server and prints the evidence directory.
- `.cursor/skills/verify-next-agent/doctor.sh <evidence-dir>` checks that instance.
- `.cursor/skills/verify-next-agent/cleanup.sh <evidence-dir>` stops that instance and keeps the proof.

The feature recipes are in `features/README.md`.
