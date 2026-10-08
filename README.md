# next-agent

This package typechecks TypeScript and runs one test. The Next.js app is a later unit.

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

`npm test` calls `isReady` from `src/ready.ts` and expects `true`.
