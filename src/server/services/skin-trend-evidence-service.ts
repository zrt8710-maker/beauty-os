import "server-only";

import { buildDailySkinMetricSnapshot, type DailySkinMetric } from "@/domain/skin-grading/daily-skin-metric-snapshot";
import type { DailyStateArea, DailyStateConcernKind, SkinCheckin } from "@/schemas/checkin";

export const TREND_WINDOW_DAYS = 28;
const MIN_CONFIRMED_DAYS_FOR_FREQUENCY = 7;
const MIN_PRESENT_DAYS_FOR_RECURRENCE = 3;

export type TrendEvidenceStrength = "limited" | "adequate" | "strong";
export type TrendStatementAllowed = "recent_multiple_records";
export type TrendComparison = { status: "insufficient_coverage" | "coverage_available"; current_confirmed_days: number; previous_confirmed_days: number };
export type TrendEvidence = {
  window: { start_date: string; end_date: string; confirmed_checkin_days: number; relevant_observation_days: number };
  concern: { kind: DailyStateConcernKind; present_days: string[]; explicit_absent_days: string[]; unknown_days: string[] };
  recurring_areas: Array<{ area: Exclude<DailyStateArea, "full_face">; present_days: number; present_dates: string[] }>;
  recurring_triggers: Array<{ trigger: string; present_days: number }>;
  grade_observations: Array<{ grade: 0 | 1 | 2 | 3 | 4; present_days: number }>;
  baseline_comparisons: Array<{ comparison: "less_than_usual" | "usual" | "more_than_usual" | "new"; present_days: number }>;
  evidence_strength: TrendEvidenceStrength;
  statements_allowed: TrendStatementAllowed[];
  comparison: TrendComparison;
};

type Observation = { status: "present" | "absent"; area: Exclude<DailyStateArea, "full_face"> | null; triggers: string[]; grade?: 0 | 1 | 2 | 3 | 4; baseline?: "less_than_usual" | "usual" | "more_than_usual" | "new" };

/**
 * Read-only evidence aggregation. It deliberately emits counts and eligibility,
 * never diagnoses, writes Profile, or generates natural-language conclusions.
 */
export function createSkinTrendEvidenceService() {
  return {
    evaluate(input: { checkins: SkinCheckin[]; concern: DailyStateConcernKind; end_date: string }): TrendEvidence {
      const end = dateAtUtcMidnight(input.end_date);
      const currentStart = addDays(end, -(TREND_WINDOW_DAYS - 1));
      const previousStart = addDays(currentStart, -TREND_WINDOW_DAYS);
      const all = input.checkins.filter((checkin) => isConfirmed(checkin));
      const current = all.filter((checkin) => inRange(checkin.recorded_date, currentStart, end));
      const previous = all.filter((checkin) => inRange(checkin.recorded_date, previousStart, addDays(currentStart, -1)));
      const observations = current.map((checkin) => ({ date: checkin.recorded_date, observation: observationFor(checkin, input.concern) }));
      const present = observations.filter((entry) => entry.observation?.status === "present");
      const absent = observations.filter((entry) => entry.observation?.status === "absent");
      const presentObservations = present.map((entry) => entry.observation as Observation);
      const known = present.length + absent.length;
      const strength = evidenceStrength(current.length, present.length);
      return {
        window: { start_date: formatDate(currentStart), end_date: input.end_date, confirmed_checkin_days: current.length, relevant_observation_days: known },
        concern: { kind: input.concern, present_days: present.map((entry) => entry.date), explicit_absent_days: absent.map((entry) => entry.date), unknown_days: observations.filter((entry) => !entry.observation).map((entry) => entry.date) },
        recurring_areas: countedAreas(present.map((entry) => ({ date: entry.date, area: (entry.observation as Observation).area }))),
        recurring_triggers: counted(presentObservations.flatMap((entry) => entry.triggers), "trigger"),
        grade_observations: counted(presentObservations.flatMap((entry) => entry.grade === undefined ? [] : [entry.grade]), "grade"),
        baseline_comparisons: counted(presentObservations.flatMap((entry) => entry.baseline ? [entry.baseline] : []), "comparison"),
        evidence_strength: strength,
        statements_allowed: strength === "limited" ? [] : ["recent_multiple_records"],
        comparison: { status: current.length >= MIN_CONFIRMED_DAYS_FOR_FREQUENCY && previous.length >= MIN_CONFIRMED_DAYS_FOR_FREQUENCY ? "coverage_available" : "insufficient_coverage", current_confirmed_days: current.length, previous_confirmed_days: previous.length },
      };
    },
  };
}

function observationFor(checkin: SkinCheckin, kind: DailyStateConcernKind): Observation | null {
  const metric = buildDailySkinMetricSnapshot(checkin).metrics.find((item) => item.concern === kind);
  if (!metric) return null;
  if (metric.daily_status === "absent") return fromMetric(metric);
  // A confirmed concern with insufficient anchors remains unknown for trend evidence.
  // It is deliberately neither a present occurrence nor an absence.
  if (metric.grade_status !== "graded") return null;
  return fromMetric(metric, triggerFor(checkin, kind));
}

function isConfirmed(checkin: SkinCheckin) { return checkin.known_fields.length > 0 || checkin.daily_state !== null; }
function fromMetric(metric: DailySkinMetric, triggers: string[] = []): Observation { return { status: metric.daily_status, area: metric.area, triggers, grade: metric.grade ?? undefined, baseline: normalizeBaseline(metric.baseline_comparison) }; }
function triggerFor(checkin: SkinCheckin, kind: DailyStateConcernKind) { const concern = checkin.daily_state?.version === 2 ? checkin.daily_state.concerns.find((item) => item.kind === kind) : null; return concern?.attributes.trigger ? [concern.attributes.trigger] : []; }
function normalizeBaseline(value: DailySkinMetric["baseline_comparison"]) { return value === "unknown" || value === undefined ? undefined : value; }
function evidenceStrength(confirmedDays: number, presentDays: number): TrendEvidenceStrength { if (confirmedDays < MIN_CONFIRMED_DAYS_FOR_FREQUENCY || presentDays < MIN_PRESENT_DAYS_FOR_RECURRENCE) return "limited"; return confirmedDays >= 14 && presentDays >= 5 ? "strong" : "adequate"; }
function counted<T extends string | number, K extends string>(values: T[], key: K): Array<Record<K, T> & { present_days: number }> { const counts = new Map<T, number>(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1); return [...counts.entries()].map(([value, present_days]) => ({ [key]: value, present_days }) as Record<K, T> & { present_days: number }).sort((a, b) => b.present_days - a.present_days); }
function countedAreas(entries: Array<{ date: string; area: Exclude<DailyStateArea, "full_face"> | null }>) { const datesByArea = new Map<Exclude<DailyStateArea, "full_face">, string[]>(); for (const entry of entries) { if (entry.area) datesByArea.set(entry.area, [...(datesByArea.get(entry.area) ?? []), entry.date]); } return [...datesByArea.entries()].map(([area, present_dates]) => ({ area, present_days: present_dates.length, present_dates })).sort((a, b) => b.present_days - a.present_days); }
function dateAtUtcMidnight(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function addDays(value: Date, days: number) { const next = new Date(value); next.setUTCDate(next.getUTCDate() + days); return next; }
function formatDate(value: Date) { return value.toISOString().slice(0, 10); }
function inRange(value: string, start: Date, end: Date) { const date = dateAtUtcMidnight(value).getTime(); return date >= start.getTime() && date <= end.getTime(); }
