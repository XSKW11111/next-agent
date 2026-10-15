# Send a message

Send a message lets a customer type in the support chat, submit it, and read the reply in the transcript. The same turn is stored for that session.

## Sub-features

- `send-type` puts the customer text in `Message`.
- `send-submit` adds that text to the transcript and shows the reply.
- `send-stored` returns the same customer text and reply from session history.
- `send-too-many-tools` runs a model reply with more than 8 tool calls in ordered chunks within the round budget and still shows an `Assistant` line. The POST stays 200.

## How to get to it (user POV)

- Open the support chat, type in `Message`, and choose `Send`.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- The page shows the heading `Support chat` and the textbox `Message`.
- Choose one harmless support question and record its exact text as `TEST_MESSAGE`. Do not reuse text already in the transcript.

- **Type.** Fill the textbox named `Message` with `TEST_MESSAGE`. The textbox shows that text and `Send` is available.
- **Send.** Choose `Send`. Capture the browser state while the customer line is visible, then wait for a later `Assistant:` line. The textbox is empty again. Do not require one fixed assistant sentence.
- **Confirm the stored turn.** Read `sessionStorage` key `next-agent-session-id`. Run `curl -sf http://127.0.0.1:<port>/api/chat/sessions/<id>/messages`. The JSON contains customer `content` equal to `TEST_MESSAGE` and assistant `content` matching the visible line.
- **Proof.** Save the action state to `evidence/send-message/action.aria.txt`, the final snapshot to `evidence/send-message/transcript.aria.txt`, the screenshot to `evidence/send-message/transcript.png`, and the history body to `evidence/send-message/history.json`. Record the session id, request status, and revision. The final snapshot and screenshot show `Support chat`, `TEST_MESSAGE`, and the assistant line.
- **Observe.** Reuse this send for [latency and tracing checks](../references/observability.md). Save the measurement and trace verdict beside the transcript proof.

## Gotchas

- The assistant line is the live model reply. A missing order number in that line is not a failure of this feature.
- Choosing `Send` while `Message` is empty does not add a turn. Fill the textbox first.
- The button stays named `Send` while the reply is in flight. On a first visit it is enabled with the empty prompt. It is disabled while a reply is in flight. It is not disabled to wait for history on a new chat. Wait until the `Assistant` line is in the transcript before reading history.
- `send-submit` is unreachable when `OPENROUTER_API_KEY`/`AI_MODEL` is missing or `https://openrouter.ai/api/v1/chat/completions` does not answer. Record that unmet precondition. Do not invent an assistant line.
- History for a different session id does not contain this turn. Use the id from this page's `sessionStorage`.
- A browser screenshot tool may save under its own temp directory. Copy that file to `evidence/send-message/transcript.png` before cleanup.
- `send-too-many-tools` fires only when the model returns more than 8 tool calls in one assistant message. Confirm the first 8 and the overflow ran in later chunks of the same send from the debug trace or tool receipts; the POST must stay 200 and history must store the final `Assistant` line. If the round budget cuts off a tail, confirm the reply names the skipped checks. The old refusal or a `too many tool calls` 500 fails this feature. If the live model never returns more than 8 calls, mark this sub-feature untested. Do not invent nine tool calls.
