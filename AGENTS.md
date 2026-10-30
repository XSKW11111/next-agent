# Agent instructions

## Output language (ASD-STE100)

When you explain work or emit text to the user, write in
[ASD-STE100](https://www.asd-ste100.org/) Simplified Technical English.

- Keep sentence structure direct: subject, verb, object.
- Use active voice.
- Prefer short sentences. Prefer one idea in each sentence.
- Use simple, approved words when you can. Avoid filler and vague words.
- Use the imperative mood for instructions.
- Do not nest clauses or stack noun modifiers.
- Keep technical terms, code identifiers, and file paths exact.
- These rules apply to explanations, summaries, plans, and other emitted output.
  They do not change code style or required file formats.

## Coding style

[CODING_STYLE.md](CODING_STYLE.md) gives the coding style for this repository.
[TYPESCRIPT_STYLE.md](TYPESCRIPT_STYLE.md) adds rules for TypeScript and presentation.
Read both files before you plan, implement, review, or test a code change.
Follow both files.

[GLOSSARY.md](GLOSSARY.md) gives the domain language for this support agent.
[next-agent-system-architecture.md](next-agent-system-architecture.md) gives the current design.

## UI

This project uses [shadcn/ui](https://ui.shadcn.com).
The style is `base-nova`.
The configuration is in [components.json](components.json).
UI components are in `src/components/ui`.
To add a component, run `npx shadcn@latest add <name>`.
Do not copy a registry file by hand.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes.
APIs, conventions, and file structure can differ from your training data.
Before you write code, read the related guide in `node_modules/next/dist/docs/`.
Find that path from this file's directory.
In a monorepo, the `next` package can be absent from the repository root.
Obey deprecation notices.

`next dev` writes and restores this block.
Confirm the source at `node_modules/next/dist/server/lib/generate-agent-files.js`.
If you remove this block from a diff, `next` will add it again as an uncommitted change.
If you commit this block with your work, the tree stays clean.

<!-- END:nextjs-agent-rules -->
