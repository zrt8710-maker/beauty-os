import { z } from "zod";

import { productSchema } from "@/schemas/product";

export const ROUTINE_PERIODS = ["am", "pm"] as const;
export const ROUTINE_ROLES = [
  "remover",
  "cleanser",
  "hydration",
  "treatment",
  "moisturizer",
  "sunscreen",
] as const;

export const ROUTINE_REASON_CODES = [
  "BASE_ROUTINE_SELECTED",
  "SKIN_DRYNESS_FIT",
  "HIGH_SENSITIVITY_BASIC_CARE",
  "HIGH_UV_SUNSCREEN_PRIORITY",
  "RECENT_POSITIVE_FEEDBACK",
  "RECENT_HIGH_REACTION_PENALTY",
  "INVENTORY_USE_FIRST",
] as const;

export const EXCLUSION_REASON_CODES = [
  "PRODUCT_NOT_ACTIVE",
  "PRODUCT_ARCHIVED",
  "PRODUCT_FINISHED",
  "PRODUCT_EMPTY",
  "PRODUCT_EXPIRED",
  "NON_SKINCARE_PRODUCT",
  "UNSUPPORTED_PRODUCT_TYPE",
  "PERIOD_NOT_APPLICABLE",
  "HIGH_SENSITIVITY_REDUCE_ACTIVE",
  "DUPLICATE_ROLE_REMOVED",
  "OPTIONAL_SLOT_REPLACED",
  "STEP_LIMIT_REMOVED",
  "RECENT_HIGH_REACTION_HARD_BLOCK",
] as const;

export const routinePeriodSchema = z.enum(ROUTINE_PERIODS);
export const routineGenerateSchema = z
  .object({ period: routinePeriodSchema.default("am") })
  .strict();

const snapshotSchema = z.record(z.string(), z.unknown());
const scoreBreakdownSchema = z
  .object({
    base: z.number().int(),
    skin_fit: z.number().int(),
    weather_fit: z.number().int(),
    feedback_score: z.number().int(),
    inventory_priority: z.number().int(),
  })
  .strict();

export const routineStepSchema = z.object({
  id: z.uuid(),
  owned_product_id: z.uuid(),
  step_order: z.number().int().min(1).max(20),
  role: z.enum(ROUTINE_ROLES),
  reason: z.string().min(1).max(500),
  reason_code: z.enum(ROUTINE_REASON_CODES),
  score: z.number().int().min(0).max(100),
  score_breakdown: scoreBreakdownSchema,
  product: productSchema,
});

export const excludedProductSchema = z.object({
  owned_product_id: z.uuid(),
  product_id: z.uuid(),
  brand_name: z.string().min(1).max(120).nullable(),
  product_name: z.string().min(1).max(200),
  reason_code: z.enum(EXCLUSION_REASON_CODES),
  reason: z.string().min(1).max(500),
});

export const routineSchema = z.object({
  id: z.uuid(),
  routine_date: z.iso.date(),
  period: routinePeriodSchema,
  skin_snapshot: snapshotSchema,
  weather_snapshot: snapshotSchema,
  status: z.enum(["generated", "completed"]),
  excluded_products: z.array(excludedProductSchema),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  steps: z.array(routineStepSchema),
});

export const routineIdSchema = z.uuid();

export type Routine = z.infer<typeof routineSchema>;
export type RoutinePeriod = z.infer<typeof routinePeriodSchema>;
export type RoutineRole = (typeof ROUTINE_ROLES)[number];
export type RoutineReasonCode = (typeof ROUTINE_REASON_CODES)[number];
export type ExclusionReasonCode = (typeof EXCLUSION_REASON_CODES)[number];
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type ExcludedProduct = z.infer<typeof excludedProductSchema>;
