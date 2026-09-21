import { z } from "zod";

import { routineRolePreferenceSchema } from "@/schemas/usage";

export const feedbackSentimentSchema = z.enum(["positive_strong", "positive_mild", "neutral", "dislike", "discomfort"]);
export const feedbackUsedStatusSchema = z.enum(["used", "not_used", "unknown"]);
export const feedbackOperationSchema = z.enum(["add", "amend", "retract"]);
export const feedbackTextureTagSchema = z.enum(["too_oily", "too_sticky", "pilling", "not_hydrating_enough", "comfortable"]);
export const feedbackReactionTagSchema = z.enum(["stinging", "redness", "breakout"]);

export const usageFeedbackProductDraftSchema = z.object({
  owned_product_id: z.uuid(),
  operation: feedbackOperationSchema.default("add"),
  used_status: feedbackUsedStatusSchema,
  sentiment: feedbackSentimentSchema.nullable(),
  texture_tags: z.array(feedbackTextureTagSchema).max(5).default([]),
  reaction_severity: z.enum(["none", "mild", "strong"]).nullable(),
  reaction_tags: z.array(feedbackReactionTagSchema).max(3).default([]),
  notes: z.string().trim().min(1).max(400).nullable(),
}).strict();

export const usageFeedbackDraftSchema = z.object({
  completion_status: z.enum(["completed", "partial", "skipped"]),
  overall_notes: z.string().trim().min(1).max(1000).nullable(),
  products: z.array(usageFeedbackProductDraftSchema).max(20).refine((products) => new Set(products.map((product) => product.owned_product_id)).size === products.length, "同一条反馈不能重复同一产品。"),
  routine_role_preferences: z.array(routineRolePreferenceSchema).max(12).default([])
    .refine((preferences) => new Set(preferences.map((preference) => `${preference.period}:${preference.routine_role}`)).size === preferences.length, "同一条反馈不能重复同一时段和护理角色。"),
}).strict();

export const usageFeedbackConversationRequestSchema = z.object({
  routine_id: z.uuid(),
  conversation_id: z.uuid(),
  message_id: z.uuid(),
  message: z.string().trim().min(1).max(2000),
  active_turn_context: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
}).strict();

export const usageFeedbackConversationResultSchema = z.object({
  reply: z.string().trim().min(1).max(1000),
  draft: usageFeedbackDraftSchema.nullable(),
}).strict();

export const usageFeedbackRecordedSummarySchema = z.object({
  outcome: z.enum(["routine_used", "routine_skipped"]),
  products: z.array(z.object({
    product_name: z.string().trim().min(1).max(360),
    observations: z.array(z.string().trim().min(1).max(400)).max(8),
  }).strict()).max(20),
  overall_note: z.string().trim().min(1).max(2000).nullable(),
}).strict();

export const usageFeedbackConversationApiResultSchema = z.object({
  reply: z.string().trim().min(1).max(1000),
  saved: z.boolean(),
  recorded_summary: usageFeedbackRecordedSummarySchema.nullable(),
}).strict();

export type UsageFeedbackDraft = z.infer<typeof usageFeedbackDraftSchema>;
export type UsageFeedbackConversationResult = z.infer<typeof usageFeedbackConversationResultSchema>;
export type UsageFeedbackRecordedSummary = z.infer<typeof usageFeedbackRecordedSummarySchema>;
