# Resume a session

Resume a session shows the earlier transcript when the customer reloads the support chat on the same browser origin.

## Sub-features

- `resume-reload` shows the stored turns after a reload.
- `resume-other-origin` starts empty on a different port.

## How to get to it (user POV)

- Send a message, then reload `http://127.0.0.1:<port>/`.
- Open the same path on a different port in a new browser session.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- This origin already shows the recorded `TEST_MESSAGE` in the transcript from Send a message.
- `sessionStorage` on this origin contains `next-agent-session-id`.

- **Reload.** Open `http://127.0.0.1:<port>/` again on the same origin. Wait for the history GET to succeed and for `TEST_MESSAGE` and the same `Assistant` line to render. `Send` is enabled after history loading finishes.
- **Proof.** Save an accessibility snapshot to `evidence/resume-session/reloaded.aria.txt` and a screenshot to `evidence/resume-session/reloaded.png`. Both show `Support chat` and `TEST_MESSAGE`.
- **Other origin.** This entry needs a second server on a second port. Do not claim it from the first port. A fresh origin shows `Ask about an order, a product, or a person.` and does not show `TEST_MESSAGE`.

## Gotchas

- `Send` can become enabled after a failed history GET because the loading flag is cleared in `finally`. An enabled button alone does not prove resume worked. Require the earlier transcript and matching history JSON.
- A new port does not share the first origin's `sessionStorage` or process-local handoff state. Hosted sessions and messages are shared, but this fresh page does not know the earlier session id.
- Do not clear `sessionStorage` before the reload proof. Clearing it starts a new session and hides the old transcript.
