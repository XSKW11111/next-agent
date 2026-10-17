# Agent instructions

## Coding style

[CODING_STYLE.md](CODING_STYLE.md) is the coding style for this repository. [TYPESCRIPT_STYLE.md](TYPESCRIPT_STYLE.md) extends it for TypeScript and presentation. Read both before planning, implementing, reviewing, or testing a code change, and follow them.

Domain language for this support agent is in [GLOSSARY.md](GLOSSARY.md). The current design is in [next-agent-system-architecture.md](next-agent-system-architecture.md).

## UI

This project uses [shadcn/ui](https://ui.shadcn.com). The style is `base-nova`, and the configuration is [components.json](components.json). Components live in `src/components/ui`. Add a component with `npx shadcn@latest add <name>` instead of copying a registry file by hand.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

- Install dependencies with `npm ci`. The dev server is `npm run dev -- --hostname 0.0.0.0 --port 3000`. Open it at `http://localhost:3000`. Next.js blocks dev resources when the browser origin is `127.0.0.1`.
- `npm run typecheck`, `npm test`, and `npm run build` do not need API keys. `GET /api/health` returns `{ "ok": true }` without them.
- Creating a chat session needs the variables in `.env.example` (`OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the listed defaults). Without them, `/` still renders and shows that the session could not be started.
- `npm run lint` fails on an existing `react-hooks/immutability` error in `src/app/chat-panel.tsx` (`sentQueued`).
