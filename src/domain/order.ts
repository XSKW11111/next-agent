import { z } from "zod";
import { brand, parse, type Parsed } from "./parse";

const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email());

export const orderEmailSchema = normalizedEmail.transform(brand<"OrderEmail">);

export type OrderEmail = z.infer<typeof orderEmailSchema>;

export const orderNumberSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => {
    const upper = value.toUpperCase();
    return upper.startsWith("#") ? upper : `#${upper}`;
  })
  .pipe(z.string().regex(/^#.+$/))
  .transform(brand<"OrderNumber">);

export type OrderNumber = z.infer<typeof orderNumberSchema>;

const maskedOrderNumberSchema = z
  .string()
  .regex(/^\*\*\*..$/)
  .transform(brand<"MaskedOrderNumber">);

const trackingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tracked"),
    trackingNumber: z.string().trim().min(1),
    trackingUrl: z.url(),
  }),
  z.strictObject({
    kind: z.literal("untracked"),
  }),
]);

const orderSchema = z.strictObject({
  orderNumber: orderNumberSchema,
  status: z.string().trim().min(1),
  tracking: trackingSchema,
});

export type Order = z.infer<typeof orderSchema>;

export const orderLookupSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("orders_found"),
    orders: z.tuple([orderSchema], orderSchema),
  }),
  z.strictObject({
    kind: z.literal("order_not_found"),
    message: z.string().trim().min(1),
    otherOrders: z.array(
      z.strictObject({
        orderNumber: maskedOrderNumberSchema,
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal("service_unavailable"),
    tool: z.literal("lookup_order"),
  }),
]);

export type OrderLookup = z.infer<typeof orderLookupSchema>;

export function parseOrderEmail(input: unknown): Parsed<OrderEmail> {
  return parse(orderEmailSchema, input);
}

export function parseOrderLookup(input: unknown): Parsed<OrderLookup> {
  return parse(orderLookupSchema, input);
}
