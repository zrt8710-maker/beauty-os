import { z } from "zod";

import {
  SKIN_CHECKIN_FIELDS,
  dailyStateCandidateSchema,
  dailyStateSchema,
  skinCheckinInputSchema,
} from "@/schemas/checkin";
import { profileInputSchema } from "@/schemas/profile";

const fieldPatchSchema = z.object({
  dryness_level: z.number().int().min(0).max(4).optional(),
  oiliness_level: z.number().int().min(0).max(4).optional(),
  redness_level: z.number().int().min(0).max(4).optional(),
  sensitivity_level: z.number().int().min(0).max(4).optional(),
  acne_level: z.number().int().min(0).max(4).optional(),
}).strict();

const modelAssessmentSchema = z.object({
  field: z.enum(SKIN_CHECKIN_FIELDS),
  status: z.enum(["known", "unknown"]),
  level: z.number().int().min(0).max(4).nullable(),
  evidence: z.string().trim().min(1).max(500),
}).strict();

const normalDayEvidenceSchema = z.object({
  user_statements: z.array(z.string().trim().min(1).max(500)).min(1).max(6),
}).strict();

/** Supporting conversation evidence used to form the confirmed daily state. */
export const skinConversationObservationsSchema = z.object({
  locations: z.array(z.string().trim().min(1).max(80)).max(8),
  tightness: z.string().trim().min(1).max(200).nullable(),
  flaking: z.string().trim().min(1).max(200).nullable(),
  roughness: z.string().trim().min(1).max(200).nullable(),
  visible_shine: z.string().trim().min(1).max(200).nullable(),
  blemish_count: z.string().trim().min(1).max(200).nullable(),
  blemish_distribution: z.string().trim().min(1).max(200).nullable(),
  pain_tenderness: z.string().trim().min(1).max(200).nullable(),
  small_bumps: z.string().trim().min(1).max(200).nullable(),
  blackheads: z.string().trim().min(1).max(200).nullable(),
  itching: z.string().trim().min(1).max(200).nullable(),
  burning: z.string().trim().min(1).max(200).nullable(),
  triggers: z.array(z.string().trim().min(1).max(120)).max(6),
  duration: z.string().trim().min(1).max(200).nullable(),
  baseline_comparison: z.string().trim().min(1).max(200).nullable(),
}).strict();

/**
 * The constrained provider payload. It is deliberately separate from the API
 * result: only this server validates it and creates the canonical proposal.
 */
export const skinConversationModelOutputSchema = z.object({
  reply: z.string().trim().min(1).max(1000),
  assessments: z.array(modelAssessmentSchema).max(SKIN_CHECKIN_FIELDS.length).default([]).superRefine((assessments, context) => {
    const fields = assessments.map((assessment) => assessment.field);
    if (new Set(fields).size !== fields.length) {
      context.addIssue({ code: "custom", message: "A field may be assessed at most once." });
    }
    for (const assessment of assessments) {
      if ((assessment.status === "known") !== (assessment.level !== null)) {
        context.addIssue({ code: "custom", message: "Known assessments require a level; unknown assessments cannot have one." });
      }
    }
  }),
  observations: skinConversationObservationsSchema.optional(),
  daily_state: dailyStateCandidateSchema.nullable().optional(),
  readiness: z.enum(["continue", "confirm", "ready"]).optional(),
  clarification: z.string().trim().min(1).max(500).nullable().optional(),
  suggested_followup: z.string().trim().min(1).max(500).nullable().optional(),
  conversational_intent: z.enum(["continue", "complete"]).optional(),
  normal_day_evidence: normalDayEvidenceSchema.nullable().optional(),
  confidence: z.number().int().min(0).max(100).optional(),
}).strict();

/**
 * Natural conversation has a deliberately smaller success boundary than fact
 * extraction. Preserve a valid reply, then admit each structured hint only if
 * it independently satisfies the frozen canonical model schema.
 */
export function parseConversationFirstModelOutput(value: unknown): SkinConversationModelOutput {
  const replyOnly = z.object({ reply: z.string().trim().min(1).max(1000) }).passthrough().parse(value);
  const raw = value as Record<string, unknown>;
  const candidate: Record<string, unknown> = { reply: replyOnly.reply };
  for (const field of ["assessments", "observations", "daily_state", "readiness", "clarification", "suggested_followup", "conversational_intent", "normal_day_evidence", "confidence"] as const) {
    if (!(field in raw)) continue;
    if (field === "daily_state") {
      if (raw.daily_state === null) { candidate.daily_state = null; continue; }
      const dailyState = dailyStateSchema.safeParse(raw.daily_state);
      if (dailyState.success) candidate.daily_state = dailyState.data;
      continue;
    }
    const parsed = skinConversationModelOutputSchema.safeParse({ reply: replyOnly.reply, [field]: raw[field] });
    if (parsed.success) candidate[field] = parsed.data[field];
  }
  return skinConversationModelOutputSchema.parse(candidate);
}

/**
 * A provider can finish the visible `reply` before malformed or truncated
 * optional JSON fields. Keep that conversation turn usable rather than
 * converting it into a provider failure.
 */
export function parseConversationFirstRawOutput(outputText: string): SkinConversationModelOutput {
  try {
    return parseConversationFirstModelOutput(JSON.parse(outputText));
  } catch {
    const match = /"reply"\s*:\s*"((?:\\.|[^"\\])*)"/u.exec(outputText);
    if (!match) throw new Error("Provider output has no recoverable reply.");
    return parseConversationFirstModelOutput({ reply: JSON.parse(`"${match[1]}"`) });
  }
}

export const skinConversationRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  active_turn_context: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
  recorded_date: z.iso.date(),
  existing_checkin: skinCheckinInputSchema.nullable(),
  profile_context: z.object({
    skin_type: z.enum(["dry", "oily", "combination", "normal", "unknown"]).nullable(),
    sensitivity_level: z.number().int().min(0).max(4),
    skin_goals: z.array(z.enum(["hydration", "barrier_support", "oil_control", "blemish_care", "redness_relief", "brightening", "dark_spots", "anti_aging"])).max(8),
    long_term_skin_baseline: profileInputSchema.shape.long_term_skin_baseline.optional().default({ usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [] }),
  }).nullable(),
  /** Retrieved preference context only; it is never a source of daily facts. */
  personalMemoryContext: z.array(z.string().trim().min(1).max(500)).max(5).default([]),
  completion_confirmation_pending: z.boolean().default(false),
  finalize_requested: z.boolean().default(false),
}).strict();

export const skinConversationResultSchema = z.object({
  reply: z.string().min(1).max(1000),
  patch: fieldPatchSchema.extend({ notes: z.string().trim().min(1).max(2000).nullable().optional() }),
  unknown_fields: z.array(z.enum(SKIN_CHECKIN_FIELDS)),
  readiness: z.enum(["continue", "confirm", "ready"]),
  completion_available: z.boolean().default(false),
  clarification: z.string().min(1).max(500).optional(),
  confidence: z.number().int().min(0).max(100),
  observations: skinConversationObservationsSchema,
  daily_state: dailyStateSchema.nullable(),
  proposed_checkin: skinCheckinInputSchema,
  changed_fields: z.array(z.enum(SKIN_CHECKIN_FIELDS)),
}).strict();

export type SkinConversationRequest = z.input<typeof skinConversationRequestSchema>;
export type SkinConversationResult = z.infer<typeof skinConversationResultSchema>;
export type SkinConversationModelOutput = z.infer<typeof skinConversationModelOutputSchema>;
