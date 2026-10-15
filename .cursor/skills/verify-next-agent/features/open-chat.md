# Open the support chat

Opening the support chat starts a session for this browser and shows an empty transcript when the customer has not sent anything yet.

## Sub-features

- `open-first` shows the empty transcript with `Send` enabled. A new session does not wait for history.
- `open-starting` lets the customer fill `Message` and choose `Send` before `sessionStorage` has an id.
- `open-failed` shows `The chat session could not be started.` and disables `Send`.

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/` in a browser whose `sessionStorage` has no `next-agent-session-id` for that origin.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- The browser origin is `http://127.0.0.1:<port>` and has no stored session id.

- **Open the page.** Go to `http://127.0.0.1:<port>/`. The document loads.
- **Empty chat can send.** The heading `Support chat`, the textbox `Message`, and the text `Ask about an order, a product, or a person.` are present. The button `Send` is enabled. There is no `You` line. A disabled `Send` on this screen is a failure. Do not wait for history. A new chat has none.
- **Still enabled after the id.** Wait until `sessionStorage` key `next-agent-session-id` is a non-empty string. The transcript is still only the empty prompt. `Send` is still enabled. If it became disabled after the id appeared, history restoration blocked a clean chat. That is a failure.
- **Proof.** Save an accessibility snapshot to `evidence/open-chat/empty.aria.txt` and a screenshot to `evidence/open-chat/empty.png` while `Send` is enabled and the empty prompt is showing. Both show `Support chat` and `Ask about an order, a product, or a person.` Record the enabled `Send` button in the snapshot.

## Gotchas

- A disabled `Send` on the empty first visit is a failed open. Do not explain it as startup or as history loading.
- The history wait belongs only to Resume a session, where the id was already stored before the page opened.
- A stored `next-agent-session-id` skips the empty state and loads history instead. Use a fresh origin for `open-first`.
- `The chat session could not be started.` means session create failed. `Send` is disabled. `Message` is still on the page. Do not submit on that screen.
