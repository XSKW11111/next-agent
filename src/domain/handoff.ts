import { z } from "zod";
import { orderNumberSchema } from "./order";
import { brand, parse, type Parsed } from "./parse";
import { sessionIdSchema } from "./session";
import { turnIdSchema } from "./turn";

const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .transform(brand<"ContactEmail">);

export type ContactEmail = z.infer<typeof contactEmailSchema>;

const proposalIdSchema = z.uuid().transform(brand<"ProposalId">);
const caseIdSchema = z.uuid().transform(brand<"CaseId">);

export type ProposalId = z.infer<typeof proposalIdSchema>;
export type CaseId = z.infer<typeof caseIdSchema>;

const handoffOrderSchema = orderNumberSchema.optional();

const handoffDraftSchema = z.strictObject({
  contactEmail: contactEmailSchema,
  reason: z.string().trim().min(1),
  orderNumber: handoffOrderSchema,
});

export const handoffResultSchema = z.strictObject({
  kind: z.literal("handoff_proposed"),
  draft: handoffDraftSchema,
});

export type HandoffResult = z.infer<typeof handoffResultSchema>;

const proposalFields = {
  id: proposalIdSchema,
  sessionId: sessionIdSchema,
  turnId: turnIdSchema,
  contactEmail: contactEmailSchema,
  reason: z.string().trim().min(1),
  orderNumber: handoffOrderSchema,
};

function sameId(left: string, right: string): boolean {
  return left === right;
}

export const proposalSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("pending"),
    ...proposalFields,
  }),
  z
    .strictObject({
      decision: z.literal("confirmed"),
      caseId: caseIdSchema,
      ...proposalFields,
    })
    .refine((value) => sameId(value.caseId, value.id)),
  z.strictObject({
    decision: z.literal("cancelled"),
    ...proposalFields,
  }),
]);

export type Proposal = z.infer<typeof proposalSchema>;

export const handoffPartSchema = z.strictObject({
  proposalId: z.uuid(),
  decision: z.enum(["pending", "confirmed", "cancelled"]),
});

export type HandoffPart = z.infer<typeof handoffPartSchema>;

export const caseStatusSchema = z.literal(["open", "closed", "resolved"]);

export type CaseStatus = z.infer<typeof caseStatusSchema>;

export const caseSchema = z.strictObject({
  id: caseIdSchema,
  contactEmail: contactEmailSchema,
  reason: z.string().trim().min(1),
  orderNumber: handoffOrderSchema,
  status: caseStatusSchema,
});

export type SupportCase = z.infer<typeof caseSchema>;

export function parseHandoffResult(input: unknown): Parsed<HandoffResult> {
  return parse(handoffResultSchema, input);
}

export function parseProposal(input: unknown): Parsed<Proposal> {
  return parse(proposalSchema, input);
}

export function parseCase(input: unknown): Parsed<SupportCase> {
  return parse(caseSchema, input);
}
