import { z } from "zod";
import { brand, parse, type Parsed } from "./parse";
import { sessionIdSchema } from "./session";

export const turnIdSchema = z.uuid().transform(brand<"TurnId">);

export type TurnId = z.infer<typeof turnIdSchema>;

export const turnSchema = z.strictObject({
  id: turnIdSchema,
  sessionId: sessionIdSchema,
  text: z.string().trim().min(1),
});

export type Turn = z.infer<typeof turnSchema>;

export function parseTurn(input: unknown): Parsed<Turn> {
  return parse(turnSchema, input);
}
