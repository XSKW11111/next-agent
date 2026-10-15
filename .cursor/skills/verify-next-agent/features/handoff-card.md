# Confirm or cancel a handoff

A handoff card lets the customer confirm or cancel a pending proposal after the assistant turn includes one. The card is absent until that proposal exists.

## Sub-features

- `handoff-capture` sends a request for a person. The model calls `capture_handoff` in `src/service/tool/support-tools.ts`.
- `handoff-pending` shows Confirm and Cancel for a pending proposal.
- `handoff-confirm` posts the confirm route and removes the buttons.
- `handoff-cancel` posts the cancel route and removes the buttons.

## How to get to it (user POV)

- Send a message that makes the assistant return a pending handoff, then use Confirm or Cancel on the card under that assistant line.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- The transcript already has an assistant line whose turn returned `data-proposal`.
- That proposal's decision is `pending`.

- **See the card.** Read the page under the assistant line. The card shows Confirm and Cancel. The labels come from `src/app/handoff-card-messages.ts`.
- **Confirm.** Choose Confirm. Require a successful `POST /api/chat/sessions/<sessionId>/handoffs/<proposalId>/confirm`, then a confirmed card without decision buttons. Reload and check the decision in history.
- **Cancel.** On a different pending card, choose Cancel. Require a successful cancel POST, then a cancelled card without decision buttons. Reload and check the decision in history.
- **Proof.** Save an accessibility snapshot and screenshot before and after each click under `evidence/handoff-card/`. Save the matching history JSON, route status, and proposal id. The pending proof shows `Support chat`, Confirm, and Cancel; the completed proof shows the final decision.

## Gotchas

- `handoff-pending` is unreachable until a model turn returns `data-proposal`. The unmet precondition is a working model call that captures a handoff. Do not draw the card by hand.
- Confirm and Cancel are A2UI buttons inside `src/app/handoff-card.tsx`. They are not the `Send` button.
- A second click is not offered after the decision is confirmed or cancelled.
- A click that only focuses a button is not a passed decision. Check the POST and persisted proposal. If no request occurs, record a product failure and leave the proposal pending; do not call the decision verified.
