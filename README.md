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
