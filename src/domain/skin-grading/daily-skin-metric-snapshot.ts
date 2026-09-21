import { gradeDailySkinConcern } from "./skin-grading-mapper";
import type { SkinGrade } from "./skin-grading-types";
import type { DailyStateArea, DailyStateConcernKind, SkinCheckin } from "@/schemas/checkin";

export type DailySkinMetric = {
  concern: DailyStateConcernKind;
  /** Only a single user-confirmed, non-full-face area is safe for cross-day comparison. */
  area: Exclude<DailyStateArea, "full_face"> | null;
  daily_status: "present" | "absent";
  grade_status: "graded" | "unknown";
  grade: SkinGrade | null;
  baseline_comparison: "less_than_usual" | "usual" | "more_than_usual" | "new" | "unknown" | undefined;
  evidence_origin: "user_raised" | "assistant_prompted" | "unknown";
};

export type DailySkinMetricSnapshot = {
  date: string;
  metrics: DailySkinMetric[];
};

/**
 * The sole daily metric derivation boundary. It reads only a saved check-in and
 * delegates every grade decision to the grading mapper; it has no persistence or Profile input.
 */
export function buildDailySkinMetricSnapshot(checkin: SkinCheckin): DailySkinMetricSnapshot {
  const concerns = checkin.daily_state?.version === 2 ? checkin.daily_state.concerns : [];
  return { date: checkin.recorded_date, metrics: concerns.map((concern) => metricFor(concern)) };
}

function metricFor(concern: Extract<SkinCheckin["daily_state"], { version: 2 }> ["concerns"][number]): DailySkinMetric {
  const result = gradeDailySkinConcern(concern);
  return {
    concern: concern.kind,
    area: reliableArea(concern.areas, concern.area_origin),
    daily_status: concern.status,
    grade_status: result.status,
    grade: result.status === "graded" ? result.grade : null,
    baseline_comparison: concern.attributes.baseline_comparison,
    evidence_origin: concern.interaction_origin ?? "unknown",
  };
}

function reliableArea(areas: DailyStateArea[], origin: "user_confirmed" | "assistant_suggested" | "unknown" | undefined): Exclude<DailyStateArea, "full_face"> | null {
  if (origin !== "user_confirmed" || areas.length !== 1 || areas[0] === "full_face") return null;
  return areas[0];
}
