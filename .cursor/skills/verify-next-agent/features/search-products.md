# Recommend a product

A product recommendation lets the customer ask for a product and read a catalog name in the assistant line. The model calls `search_products` in `src/service/tool/support-tools.ts`. The customer does not see the tool name.

## Sub-features

- `product-backpack` asks for a backpack and gets an assistant line that names a hosted product.
- `product-stock` checks a stock count against the current product card, when the reply makes a stock claim.
- `product-absent` asks for a product the catalog does not have and does not invent a stock count.

## How to get to it (user POV)

- Open the support chat, wait until `Send` is enabled, and send `Recommend a backpack`.

## Driving it with the browser

Preconditions:

- `doctor.sh` printed `ok` for this run's evidence directory.
- `Send` is enabled.
- `OPENROUTER_API_KEY` and `AI_MODEL` are set, and `POST https://openrouter.ai/api/v1/chat/completions` returns a completion. A semantic search also calls `POST https://openrouter.ai/api/v1/embeddings`. Without those, this feature is unreachable.
- `list_products` or `match_products` answers for the hosted catalog.

- **Ask.** Fill `Message` with `Recommend a backpack`. Choose `Send`.
- **Read the reply and card.** Wait for an `Assistant` line. It names a product in the product card under that line. If the reply claims a stock count, compare it with that card. Do not require one fixed sentence or a previously measured count.
- **Absent product.** In another turn, ask for a product the returned catalog does not contain. Check that the reply does not invent a matching product or stock count. Mark `product-absent` untested if the model instead recommends alternatives or the catalog result does not establish absence.
- **Confirm the stored turn.** `GET /api/chat/sessions/<id>/messages` contains the customer text, assistant line, and matching product `toolCards` when the tool ran.
- **Proof.** Save `evidence/search-products/transcript.aria.txt`, `evidence/search-products/transcript.png`, and `evidence/search-products/history.json`. Both images show `Support chat` and the product name in the assistant line.

## Gotchas

- `product-backpack` is unreachable when the model or the embedding request fails. Record the unmet precondition.
- A `list_products` call from a script is not this feature. The proof is the assistant line after `Send`.
