# TypeScript coding style

This file extends [CODING_STYLE.md](CODING_STYLE.md) for TypeScript in this repository. Read both. **Must**, **Should**, and **May** mean what they mean there.

## Compiler contract

`tsconfig.json` is the type contract. These options must stay enabled.

- `strict`
- `verbatimModuleSyntax`
- `noUncheckedIndexedAccess`
- `isolatedModules`

Do not silence a type error with `any`, a non-null assertion, or a cast. The base guide already forbids an unsafe cast used to hide a design error. The one allowed cast in this repository is `brand` in `src/domain/parse.ts`, and that file states the proof.

## Modules

- Place every import at the top of the module.
- Use `import type` for a type-only import, so the compiler can erase it.
- Do not import inside a function body, a type annotation, or an interface field. A circular dependency is the only exception, and the file must say why.
- The path alias `@/*` maps to `src/*`. A relative import is also valid. Do not mix the two styles for the same target in one file.

## Types

- Model a value that has several valid states as a discriminated union. Switch on the discriminant. The default arm must assign the remaining value to `never`, so a new variant fails the build until it is handled.
- An indexed read is `T | undefined` under `noUncheckedIndexedAccess`. Narrow it before use. Do not assume an array access succeeded.
- Brand a primitive when a plain `string` or `number` would allow a value from the wrong domain to type-check. Orders, sessions, turns, and emails already do this.
- Prefer `readonly` on fields that callers must not reassign.
- Do not add an alias that only renames another type.

## Boundaries

External input arrives as `unknown`. Parse it at the boundary with a Zod schema, then use the parsed value inside the program.

- Domain parsers return `Parsed<T>` from `src/domain/parse.ts`. Failure is `{ ok: false }`. It is not an exception for an expected rejection.
- A service failure, such as a dependency outage, stays on the failure path from the base guide. Do not collapse it into `{ ok: false }` from a parser.
- Do not call a domain function with an unparsed request body, database row, or model argument.

## CSS placement

Keep each CSS rule next to the component it changes. A long-distance rule reaches that component from `src/app/globals.css` or from a parent stylesheet the component does not own. Put the rule in the stylesheet the component imports.

`src/app/globals.css` owns presentation for every page. That is the shared theme tokens and the document canvas, including the page background and the default text color. Do not put a feature layout rule there.

- The component that changes owns the rule. The lowest such component wins. The chat shell owns page padding. The composer owns the width of its submit button. `Button` owns only the shape that every button shares. Do not style one screen's button from the shared control.
- A utility class may sit on the element it paints. Do not use a utility prefix as the only definition of a feature breakpoint. Name that breakpoint in an `@media` rule in the component's stylesheet.
- Prove the rule on the rendered page at each breakpoint it names. A type check does not prove the layout.

## Tests

Tests run with Vitest. Assert the observable result against a literal expected value. A test that would still pass when the function under test returns `undefined` does not count.
