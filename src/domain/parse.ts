import type { ZodType } from "zod";

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

export function parse<T>(schema: ZodType<T>, input: unknown): Parsed<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false };
}

export type Brand<Name extends string> = { readonly __brand: Name };

export function brand<Name extends string>(value: string): string & Brand<Name> {
  // Schemas call this only after they accept the string. The cast is the brand.
  return value as string & Brand<Name>;
}
