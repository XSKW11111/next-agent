# Look up an order

Looking up an order lets the customer ask about an order number and read the status in the assistant line. The model calls `lookup_order` in `src/service/tool/support-tools.ts`. The customer does not see the tool name.

## Sub-features

- `lookup-w002` asks about `#W002` and gets an assistant line that names that order.
- `lookup-status` compares the reply and order card with the current hosted order status and tracking URL.
- `lookup-missing` asks about an order the email does not have and does not invent a tracking number.

## How to get to it (user POV)

- Open the support chat, wait until `Send` is enabled, and send the email on the order plus `Where is order #W002?`.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- `Send` is enabled.
- `OPENROUTER_API_KEY` and `AI_MODEL` are set, and `POST https://openrouter.ai/api/v1/chat/completions` returns a completion. Without that, this feature is unreachable.
- The hosted `orders` row `#W002` still exists.

- **Ask.** Fill `Message` with the email on `#W002` and `Where is order #W002?`. Choose `Send`.
- **Read the reply and card.** Wait for an `Assistant` line. It names `#W002` and the status from the hosted row. The order card under that line shows the same order, status, and tracking URL when available. Do not require one fixed sentence or a previously measured status.
- **Confirm the stored turn.** Read `sessionStorage` key `next-agent-session-id`. `GET /api/chat/sessions/<id>/messages` contains the customer text, assistant line, and matching `toolCards` order data.
- **Proof.** Save `evidence/lookup-order/transcript.aria.txt`, `evidence/lookup-order/transcript.png`, and `evidence/lookup-order/history.json`. The snapshot and the screenshot show `Support chat`, `#W002`, and the assistant line.

## Gotchas

- `lookup-w002` is unreachable when the model request fails. Record the unmet precondition. Do not paste a status the page did not show.
- The tool needs the email argument. If the assistant asks for the email, send it in the next turn and wait until `Send` is enabled again.
- A direct database read is not this feature. The proof is the assistant line after `Send`.
