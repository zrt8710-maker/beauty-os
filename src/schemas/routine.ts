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
  "AVOID_INGREDIENT_MATCH",
] as const;

export const routinePeriodSchema = z.enum(ROUTINE_PERIODS);
export const routineGenerateSchema = z
  .object({
    period: routinePeriodSchema.default("am"),
    /** Explicit user intent only; ordinary generation retains stability reuse. */
    forceRegenerate: z.boolean().default(false),
  })
  .strict();

const snapshotSchema = z.record(z.string(), z.unknown());
const dailyCarePriorityCodeSchema = z.enum([
  "hydration",
  "barrier_support",
  "oil_balance",
  "soothing",
  "reduce_irritation",
  "sun_protection",
]);
const dailyCareRestrictionCodeSchema = z.enum([
  "REDUCE_TREATMENT",
  "LIMIT_LAYERING",
  "AVOID_HEAVY_OIL",
  "PREFER_GENTLE_ROUTINE",
]);
const capabilityGapSchema = z.object({
  role: z.enum(ROUTINE_ROLES),
  reason: z.enum(["NO_OWNED_PRODUCT", "ALL_PRODUCTS_UNAVAILABLE", "ALL_PRODUCTS_SAFETY_EXCLUDED", "INGREDIENT_DATA_UNKNOWN"]),
  ownedProductIds: z.array(z.uuid()),
  message: z.string(),
});
const scoreBreakdownSchema = z
  .object({
    base: z.number().int(),
    skin_fit: z.number().int(),
    weather_fit: z.number().int(),
    feedback_score: z.number().int(),
    inventory_priority: z.number().int(),
  })
  .strict();

const routineExplanationSchema = z.object({
  priorities: z.array(z.object({
    code: dailyCarePriorityCodeSchema,
    level: z.enum(["low", "medium", "high"]),
    weight: z.number(),
    reasonCodes: z.array(z.string()),
  })),
  reasons: z.array(z.object({
    code: z.string(),
    source: z.enum(["baseline", "profile", "checkin", "weather", "history"]),
    message: z.string(),
  })),
  restrictions: z.array(z.object({
    code: dailyCareRestrictionCodeSchema,
    severity: z.enum(["hard", "soft"]),
    appliesToRoles: z.array(z.enum(ROUTINE_ROLES)),
    reasonCodes: z.array(z.string()),
  })),
  capability_gaps: z.array(capabilityGapSchema),
});

export const routineDecisionSnapshotSchema = z.object({
  version: z.literal(1),
  dailyCareNeeds: z.object({
    priorities: z.array(z.object({
      code: dailyCarePriorityCodeSchema,
      level: z.enum(["low", "medium", "high"]),
      weight: z.number(),
      reasonCodes: z.array(z.string()),
    })),
    requiredRoles: z.array(z.enum(ROUTINE_ROLES)),
    optionalRoles: z.array(z.enum(ROUTINE_ROLES)),
    restrictions: z.array(z.object({
      code: dailyCareRestrictionCodeSchema,
      severity: z.enum(["hard", "soft"]),
      appliesToRoles: z.array(z.enum(ROUTINE_ROLES)),
      reasonCodes: z.array(z.string()),
    })),
    reasons: z.array(z.object({
      code: z.string(),
      source: z.enum(["baseline", "profile", "checkin", "weather", "history"]),
      message: z.string(),
    })),
    unknowns: z.array(z.object({
      code: z.enum(["PROFILE_MISSING", "CHECKIN_MISSING", "WEATHER_MISSING", "UV_INDEX_MISSING", "HISTORY_MISSING"]),
      impact: z.string(),
      fallback: z.string(),
    })),
  }),
  routinePolicy: z.object({
    baselineRoles: z.array(z.enum(ROUTINE_ROLES)),
    baselineCoverage: z.array(dailyCarePriorityCodeSchema),
    residualPriorities: z.array(dailyCarePriorityCodeSchema),
    unresolvedResidualPriorities: z.array(dailyCarePriorityCodeSchema),
  }),
  selectedSteps: z.array(z.object({
    ownedProductId: z.uuid(),
    role: z.enum(ROUTINE_ROLES),
    decision: z.enum(["baseline", "condition_added"]),
    coveredPriorities: z.array(dailyCarePriorityCodeSchema),
  })),
  abstentions: z.array(z.object({
    role: z.enum(["cleanser", "treatment", "remover"]),
    code: z.enum(["NO_TREATMENT_DIRECTION", "AM_CLEANSER_ABSTAIN", "PM_REMOVER_ABSTAIN"]),
  })),
  capabilityGaps: z.array(capabilityGapSchema),
  reuseContext: z.object({
    version: z.literal(1),
    profileDecisionSignature: z.string().regex(/^[a-f0-9]{64}$/u),
    skinDecisionSignals: z.array(z.string()),
    weatherDecisionBuckets: z.object({
      temperature: z.enum(["unknown", "cold", "mild", "hot"]),
      humidity: z.enum(["unknown", "dry", "balanced", "humid"]),
      uv: z.enum(["unknown", "low_medium", "high"]),
    }),
    selectedProducts: z.array(z.object({
      ownedProductId: z.uuid(),
      decisionSignature: z.string().regex(/^[a-f0-9]{64}$/u),
      usageSignature: z.string().regex(/^[a-f0-9]{64}$/u),
    })),
    routineRolePreferencesSignature: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict().optional(),
  planner: z.object({
    version: z.literal(1),
    generationSource: z.enum(["llm", "deterministic_fallback"]),
    strategy: z.enum(["maintain", "simplify", "barrier_focused", "balanced"]).nullable(),
    strategySummary: z.string().max(360).nullable(),
    structuredDecision: z.any().nullable(),
  }).optional(),
}).strict();

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
  decision_snapshot: routineDecisionSnapshotSchema.nullable(),
  status: z.enum(["generated", "completed"]),
  excluded_products: z.array(excludedProductSchema),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  steps: z.array(routineStepSchema),
  explanation: routineExplanationSchema.optional(),
});

export const routineIdSchema = z.uuid();

export type Routine = z.infer<typeof routineSchema>;
export type RoutinePeriod = z.infer<typeof routinePeriodSchema>;
export type RoutineRole = (typeof ROUTINE_ROLES)[number];
export type RoutineReasonCode = (typeof ROUTINE_REASON_CODES)[number];
export type ExclusionReasonCode = (typeof EXCLUSION_REASON_CODES)[number];
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type ExcludedProduct = z.infer<typeof excludedProductSchema>;
export type RoutineDecisionSnapshot = z.infer<typeof routineDecisionSnapshotSchema>;
