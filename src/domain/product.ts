import { z } from "zod";
import { parse, type Parsed } from "./parse";

export const productSchema = z.strictObject({
  name: z.string().trim().min(1),
  stockLevel: z.number().int().nonnegative(),
});

export type Product = z.infer<typeof productSchema>;

export function parseProduct(input: unknown): Parsed<Product> {
  return parse(productSchema, input);
}
