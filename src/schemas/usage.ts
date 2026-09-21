import { z } from "zod";

import { ROUTINE_PERIODS, ROUTINE_ROLES } from "@/schemas/routine";

export const COMPLETION_STATUSES = ["completed", "partial", "skipped"] as const;

export const routineRolePreferenceSchema = z.object({
  scope: z.literal("routine_role"),
  period: z.enum(ROUTINE_PERIODS),
  routine_role: z.enum(ROUTINE_ROLES),
  polarity: z.enum(["avoid", "prefer"]),
}).strict();

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);
const nullableRating = z.number().int().min(1).max(5).nullable().default(null);
const nullableReactionLevel = z.number().int().min(0).max(4).nullable().default(null);

export const usageProductInputSchema = z
  .object({
    owned_product_id: z.uuid(),
    rating: nullableRating,
    reaction_level: nullableReactionLevel,
    reaction_tags: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
    texture_feedback: nullableText(100),
    notes: nullableText(1000),
  })
  .strict()
  .refine(
    (product) => product.rating !== null
      || product.reaction_level !== null
      || product.reaction_tags.length > 0
      || product.texture_feedback !== null
      || product.notes !== null,
    "产品反馈至少需要填写一项。",
  );

export const usageRecordInputSchema = z
  .object({
    completion_status: z.enum(COMPLETION_STATUSES).default("completed"),
    overall_rating: nullableRating,
    skin_reaction_level: nullableReactionLevel,
    notes: nullableText(2000),
    products: z.array(usageProductInputSchema).max(20).default([]),
  })
  .strict()
  .refine(
    (input) => new Set(input.products.map((product) => product.owned_product_id)).size
      === input.products.length,
    "同一产品不能在一次使用记录中重复提交。",
  )
  .superRefine((input, context) => {
    if (input.completion_status === "skipped" && input.notes === null) {
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "跳过方案时请记录原因。",
      });
    }
  });

export const usageHistoryProductSchema = usageProductInputSchema.extend({
  id: z.uuid(),
  usage_history_id: z.uuid(),
  created_at: z.iso.datetime(),
});

export const usageHistorySchema = z.object({
  id: z.uuid(),
  routine_id: z.uuid(),
  used_date: z.iso.date(),
  period: z.enum(["am", "pm"]),
  completion_status: z.enum(COMPLETION_STATUSES),
  overall_rating: z.number().int().min(1).max(5).nullable(),
  skin_reaction_level: z.number().int().min(0).max(4).nullable(),
  notes: z.string().max(2000).nullable(),
  routine_role_preferences: z.array(routineRolePreferenceSchema).max(12).default([]),
  created_at: z.iso.datetime(),
  products: z.array(usageHistoryProductSchema),
});

export const usageHistoryListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
  .strict();

export const usageHistoryIdSchema = z.uuid();

export type UsageRecordInput = z.infer<typeof usageRecordInputSchema>;
export type UsageHistory = z.infer<typeof usageHistorySchema>;
export type UsageHistoryListQuery = z.infer<typeof usageHistoryListQuerySchema>;
export type RoutineRolePreference = z.infer<typeof routineRolePreferenceSchema>;
