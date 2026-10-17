# next-agent

This package typechecks TypeScript, runs tests, and builds the Next.js app.

## Check the package

Install dependencies, typecheck the sources, then run the test.

1. Install dependencies.

   ```bash
   npm install
   ```

2. Typecheck the TypeScript sources.

   ```bash
   npm run typecheck
   ```

3. Run the test.

   ```bash
   npm test
   ```

`npm test` calls `isReady` from `src/ready.ts` and expects `true`. It also calls `GET` from `src/app/api/health/route.ts` and expects status 200 and `{ "ok": true }`.

## Build the app

Run `npm run build`.

## Open the app

Run `npm start`. Open `/`. The page shows the text next-agent.

`GET /api/health` returns status 200 and `{ "ok": true }`.

## Verify LangSmith observations

A new support turn writes a `support-turn` root run to `LANGSMITH_PROJECT`. The root keeps the customer-facing input and reply. Executed tools have child spans with only the tool name, call ID, outcome, and timing. OpenRouter chat and summary calls have `llm` spans. An embedding call has an `llm` span named `embed-query` under its tool so LangSmith includes its reported tokens in project totals.

For a synthetic tool-using turn, read the root and child runs after a bounded ingestion wait. Match the root session and turn IDs, inspect child parent IDs and start/end times, and compare `outputs.usage_metadata` with LangSmith token and cost columns. Provider usage is optional. Missing values remain unknown even if LangSmith displays zero. Check `extra.metadata.usageReported` and `costReported` on provider spans, and `extra.tokenUsageComplete`, `costUsageComplete`, and `observationFailures` on the root before treating an aggregate as complete. Verify that child inputs, outputs, and metadata contain no prompt, tool argument, or result text. A child upload failure must not change the saved customer reply.
