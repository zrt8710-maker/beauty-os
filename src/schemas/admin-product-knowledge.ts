import { z } from "zod";

import { PRODUCT_TYPES } from "@/schemas/product";

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable();

/** The editable, human-maintained subset of a research snapshot. */
export const adminProductKnowledgeEditSchema = z.object({
  overall_confidence: z.number().int().min(0).max(100).nullable(),
  ingredients: z.object({
    status: z.enum(["found", "partial", "conflicted", "unknown"]),
    raw_text: z.array(text(50_000)).max(20),
    item_names: z.array(text(500)).max(500),
  }).strict(),
  claims: z.array(text(5000)).max(100),
  product_type: z.enum(PRODUCT_TYPES).nullable(),
  texture: nullableText(120),
  usage: z.object({
    instructions: z.array(text(2000)).max(50),
    am_pm: z.array(z.enum(["am", "pm"])).max(2),
    frequency: nullableText(500),
    routine_order: nullableText(500),
    leave_on: z.boolean().nullable(),
    rinse_off: z.boolean().nullable(),
    cautions: z.array(text(2000)).max(50),
  }).strict(),
}).strict();

export type AdminProductKnowledgeEdit = z.infer<typeof adminProductKnowledgeEditSchema>;
