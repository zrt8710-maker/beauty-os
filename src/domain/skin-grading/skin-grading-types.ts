import type { DailyStateConcern, DailyStateConcernKind } from "@/schemas/checkin";

export type SkinGrade = 0 | 1 | 2 | 3 | 4;
export type SkinGradeConfidence = "low" | "medium" | "high";
export type SkinGradingFamily = "direct_ordinal" | "composite";

export type SkinGradeAnchor = {
  id: string;
  grade: SkinGrade;
  label: string;
  description: string;
};

/** Consumer-facing observation guidance. It is presentation-only and never mapper input. */
export type SkinGradingObservationMethod = {
  where_to_look: readonly string[];
  how_to_observe: readonly string[];
  what_to_notice: readonly string[];
  touch_guidance?: readonly string[];
  good_conditions: readonly string[];
  avoid_conditions: readonly string[];
  plain_language_note?: string;
};

export type SkinGradingConcernDefinition = {
  kind: DailyStateConcernKind;
  label: string;
  family: SkinGradingFamily;
  anchors: Record<SkinGrade, SkinGradeAnchor>;
  observation_method: SkinGradingObservationMethod;
  required_attributes: readonly string[];
};

export type GradedSkinResult = {
  status: "graded";
  concern: DailyStateConcernKind;
  grade: SkinGrade;
  label: string;
  anchor_id: string;
  confidence: SkinGradeConfidence;
  evidence: string[];
  rationale: string;
};

export type UnknownSkinGradeResult = {
  status: "unknown";
  concern: DailyStateConcernKind;
  reason: string;
};

export type SkinGradeResult = GradedSkinResult | UnknownSkinGradeResult;

/** Future-only domain value. Persistence and UI are intentionally out of scope. */
export type SkinGradeManualOverride =
  | { status: "graded"; grade: SkinGrade }
  | { status: "unknown"; reason: string };

export type ResolvedSkinGrade = {
  automatic: SkinGradeResult;
  presentation: SkinGradeResult;
  provenance: "automatic" | "manual";
};

/** The mapper intentionally accepts only an already-validated v2 concern fact. */
export type SkinGradingInput = Pick<DailyStateConcern, "kind" | "status" | "areas" | "attributes" | "area_origin">;
