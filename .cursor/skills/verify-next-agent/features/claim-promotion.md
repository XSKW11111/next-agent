# Claim the early risers promotion

Claiming the promotion lets the customer ask for the early risers offer and read the result in the assistant line. The model calls `claim_early_risers` in `src/service/tool/support-tools.ts`. The window is 08:00-10:00 in the session timezone.

## Sub-features

- `claim-unresolved` asks from the browser and gets no code while the loaded session lacks a timezone.
- `claim-window` can issue a code only for a resolved timezone during 08:00-10:00.
- `claim-outside` returns no new code outside that window.
- `claim-code` shows an `EARLY-` code and promotion card only when the tool returns `promotion_eligible`.

## How to get to it (user POV)

- Open the support chat, wait until `Send` is enabled, and send `I want the early risers promotion` plus the email for the offer.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- `Send` is enabled.
- `OPENROUTER_API_KEY` and `AI_MODEL` are set, and `POST https://openrouter.ai/api/v1/chat/completions` returns a completion. Without that, this feature is unreachable.
- The browser supplies a timezone when creating a session, but the hosted session store does not save or restore it. The message route has no replacement timezone field. On this browser path, `claim-window`, `claim-outside`, and `claim-code` are currently unreachable. Record this as a product gap; do not infer an in-window result from the wall clock.

- **Ask.** Fill `Message` with `I want to claim the Early Risers discount`. Choose `Send`.
- **Read the unresolved result.** Wait for an `Assistant` line. It may explain the offer but must not show a new `EARLY-` code or promotion card when the timezone is unresolved. If a trace is available, confirm the tool result is `timezone_unresolved`.
- **If timezone persistence is repaired later.** Use a controlled clock and a known browser timezone to drive separate in-window and out-of-window turns. Confirm a code and promotion card only for `promotion_eligible`; check the card and stored `toolCards` against the reply.
- **Confirm the stored turn.** `GET /api/chat/sessions/<id>/messages` contains the customer text and that assistant line.
- **Proof.** Save `evidence/claim-promotion/transcript.aria.txt`, `evidence/claim-promotion/transcript.png`, and `evidence/claim-promotion/history.json`.

## Gotchas

- Do not treat a database `claim_promotion` call as this feature. The proof is the assistant line after `Send`.
- A code left in `promotion_codes` by a script is not the customer claim. Delete script rows. Do not delete a code the page just issued until the proof is saved.
- The current browser claim path cannot reach a resolved timezone after session reload. Do not report the in-window or out-of-window paths as verified from an unresolved reply.
