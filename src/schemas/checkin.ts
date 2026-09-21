import { z } from "zod";

export const SKIN_LEVEL_MIN = 0;
export const SKIN_LEVEL_MAX = 4;

export const SKIN_CHECKIN_FIELDS = [
  "dryness_level",
  "oiliness_level",
  "redness_level",
  "sensitivity_level",
  "acne_level",
] as const;
export const SKIN_CHECKIN_PROVENANCE = [
  "manual",
  "conversation",
  "image",
  "legacy",
] as const;

export type SkinCheckinField = (typeof SKIN_CHECKIN_FIELDS)[number];
export type SkinCheckinProvenance = (typeof SKIN_CHECKIN_PROVENANCE)[number];

export const DAILY_STATE_DETAIL_FINDINGS = [
  "oil_shine", "dryness", "flaking", "roughness", "redness", "small_bumps",
  "blemishes", "blackheads", "tightness", "itching", "burning", "tenderness", "other",
] as const;
export type DailyStateDetailFinding = (typeof DAILY_STATE_DETAIL_FINDINGS)[number];

export const DAILY_STATE_CONCERN_KINDS = [
  "oiliness", "dryness", "flaking", "roughness", "redness", "stinging", "itching", "burning",
  "blemishes", "small_bumps", "blackheads", "visible_pores", "uneven_tone", "dullness", "post_blemish_marks",
] as const;
export const DAILY_STATE_AREAS = [
  "t_zone", "forehead", "hairline", "nose", "nose_wings", "cheeks", "chin", "eye_area", "full_face", "other",
] as const;
export type DailyStateConcernKind = (typeof DAILY_STATE_CONCERN_KINDS)[number];
export type DailyStateArea = (typeof DAILY_STATE_AREAS)[number];

const skinLevelSchema = z.number().int().min(SKIN_LEVEL_MIN).max(SKIN_LEVEL_MAX);
const nullableNotesSchema = z.string().trim().min(1).max(2000).nullable();
const knownFieldsSchema = z.array(z.enum(SKIN_CHECKIN_FIELDS)).max(5)
  .refine((fields) => new Set(fields).size === fields.length, "不能包含重复的已记录字段。");
const provenanceValuesSchema = z.array(z.enum(SKIN_CHECKIN_PROVENANCE)).min(1).max(4)
  .refine((sources) => new Set(sources).size === sources.length, "来源不能重复。");
const provenanceSchema = z.object({
  dryness_level: provenanceValuesSchema.optional(),
  oiliness_level: provenanceValuesSchema.optional(),
  redness_level: provenanceValuesSchema.optional(),
  sensitivity_level: provenanceValuesSchema.optional(),
  acne_level: provenanceValuesSchema.optional(),
}).strict();
const dailyStateSourceSchema = z.array(z.enum(SKIN_CHECKIN_PROVENANCE)).min(1).max(4)
  .refine((sources) => new Set(sources).size === sources.length, "来源不能重复。");
export const dailyStateDetailSchema = z.object({
  area: z.string().trim().min(1).max(80).nullable(),
  finding: z.enum(DAILY_STATE_DETAIL_FINDINGS),
  status: z.enum(["present", "absent"]),
  description: z.string().trim().min(1).max(400).nullable(),
  source: dailyStateSourceSchema,
}).strict();
export const dailyStateV1CandidateSchema = z.object({
  version: z.literal(1),
  summary: z.string().trim().min(1).max(2000).nullable(),
  details: z.array(dailyStateDetailSchema).max(24),
}).strict();
export const dailyStateV1Schema = dailyStateV1CandidateSchema.superRefine((value, context) => {
  if (value.summary === null && value.details.length === 0) {
    context.addIssue({ code: "custom", message: "每日状态至少需要摘要或一条详情。" });
  }
});

const dailyStateAttributesSchema = z.object({
  severity: z.enum(["slight", "mild", "moderate", "marked"]).optional(),
  amount: z.enum(["isolated", "few", "several", "many", "widespread"]).optional(),
  distribution: z.enum(["localized", "scattered", "clustered", "widespread"]).optional(),
  onset: z.enum(["today", "recent", "ongoing", "unknown"]).optional(),
  duration: z.enum(["transient", "part_day", "all_day", "several_days", "unknown"]).optional(),
  persistence: z.enum(["transient", "recurrent", "persistent", "unknown"]).optional(),
  trigger: z.string().trim().min(1).max(120).optional(),
  tenderness: z.enum(["absent", "present", "unknown"]).optional(),
  baseline_comparison: z.enum(["less_than_usual", "usual", "more_than_usual", "new", "unknown"]).optional(),
}).strict();

const interactionOriginSchema = z.enum(["user_raised", "assistant_prompted", "unknown"]);
const areaOriginSchema = z.enum(["user_confirmed", "assistant_suggested", "unknown"]);

const amountConcernKinds = new Set<DailyStateConcernKind>(["flaking", "blemishes", "small_bumps", "blackheads", "visible_pores"]);
const tendernessConcernKinds = new Set<DailyStateConcernKind>(["blemishes", "small_bumps"]);
const triggerConcernKinds = new Set<DailyStateConcernKind>(["oiliness", "dryness", "flaking", "redness", "stinging", "itching", "burning"]);
export const dailyStateConcernSchema = z.object({
  kind: z.enum(DAILY_STATE_CONCERN_KINDS),
  status: z.enum(["present", "absent"]),
  areas: z.array(z.enum(DAILY_STATE_AREAS)).min(1).max(4).refine((areas) => new Set(areas).size === areas.length, "区域不能重复。"),
  attributes: dailyStateAttributesSchema,
  user_wording: z.array(z.string().trim().min(1).max(120)).max(6).refine((items) => new Set(items).size === items.length, "用户表述不能重复。"),
  source: dailyStateSourceSchema,
  /** Added after v2 launch; old JSONB records intentionally omit these fields. */
  interaction_origin: interactionOriginSchema.optional(),
  area_origin: areaOriginSchema.optional(),
}).strict().superRefine((value, context) => {
  if ((value.attributes.amount || value.attributes.distribution) && !amountConcernKinds.has(value.kind)) {
    context.addIssue({ code: "custom", path: ["attributes"], message: "该关注项不支持数量或分布属性。" });
  }
  if (value.attributes.tenderness && !tendernessConcernKinds.has(value.kind)) {
    context.addIssue({ code: "custom", path: ["attributes", "tenderness"], message: "触痛只适用于痘痘或小凸起。" });
  }
  if (value.attributes.trigger && !triggerConcernKinds.has(value.kind)) {
    context.addIssue({ code: "custom", path: ["attributes", "trigger"], message: "该关注项不支持诱因属性。" });
  }
});
export const dailyStateV2CandidateSchema = z.object({
  version: z.literal(2),
  summary: z.string().trim().min(1).max(2000).nullable(),
  concerns: z.array(dailyStateConcernSchema).max(24),
}).strict();
export const dailyStateV2Schema = dailyStateV2CandidateSchema.superRefine((value, context) => {
  if (value.summary === null && value.concerns.length === 0) {
    context.addIssue({ code: "custom", message: "每日状态至少需要摘要或一项关注。" });
  }
});

/** Accepted provider candidates may be empty only while the conversation continues. */
export const dailyStateCandidateSchema = z.union([dailyStateV1CandidateSchema, dailyStateV2CandidateSchema]);
/** Durable daily state: both legacy v1 and the concern-led v2 remain readable. */
export const dailyStateSchema = z.union([dailyStateV1Schema, dailyStateV2Schema]);

const skinCheckinInputBaseSchema = z
  .object({
    dryness_level: skinLevelSchema,
    oiliness_level: skinLevelSchema,
    redness_level: skinLevelSchema,
    /** Today's reactive discomfort signal; distinct from Profile's long-term tendency. */
    sensitivity_level: skinLevelSchema,
    acne_level: skinLevelSchema,
    notes: nullableNotesSchema,
    daily_state: dailyStateSchema.nullable().default(null),
    recorded_date: z.iso.date(),
    known_fields: knownFieldsSchema,
    field_provenance: provenanceSchema,
  })
  .strict();

export const skinCheckinInputSchema = skinCheckinInputBaseSchema
  .superRefine((value, context) => {
    for (const key of Object.keys(value.field_provenance) as SkinCheckinField[]) {
      if (!value.known_fields.includes(key)) {
        context.addIssue({ code: "custom", path: ["field_provenance", key], message: "来源只能属于已记录字段。" });
      }
    }
  });

export const skinCheckinUpdateSchema = skinCheckinInputBaseSchema
  .omit({ recorded_date: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少需要更新一个字段。");

export const skinCheckinSchema = skinCheckinInputSchema.extend({
  id: z.uuid(),
  created_at: z.iso.datetime(),
  is_legacy: z.boolean(),
});

export const skinCheckinListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(30).default(7),
  })
  .strict();

export const skinCheckinIdSchema = z.uuid();

export type SkinCheckin = z.infer<typeof skinCheckinSchema>;
export type SkinCheckinInput = z.infer<typeof skinCheckinInputSchema>;
export type SkinCheckinUpdateInput = z.infer<typeof skinCheckinUpdateSchema>;
export type SkinCheckinListQuery = z.infer<typeof skinCheckinListQuerySchema>;
export type DailyState = z.infer<typeof dailyStateSchema>;
export type DailyStateDetail = z.infer<typeof dailyStateDetailSchema>;
export type DailyStateConcern = z.infer<typeof dailyStateConcernSchema>;
