import { buildDailySkinMetricSnapshot } from "@/domain/skin-grading/daily-skin-metric-snapshot";
import type { SkinGrade } from "@/domain/skin-grading/skin-grading-types";
import type { DailyStateArea, DailyStateConcern, DailyStateConcernKind, SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

export type EffectiveDailySkinProvenance = "manual_override" | "today_confirmed" | "baseline_inherited" | "unknown";
export type EffectiveDailySkinItem = {
  key: string;
  concern: DailyStateConcernKind;
  area: DailyStateArea;
  status: "present" | "absent" | "unknown";
  grade: SkinGrade | null;
  baselineComparison: DailyStateConcern["attributes"]["baseline_comparison"] | null;
  provenance: EffectiveDailySkinProvenance;
  todayConcern: DailyStateConcern | null;
};
export type EffectiveDailySkinState = {
  items: EffectiveDailySkinItem[];
  todayOverrides: EffectiveDailySkinItem[];
  inheritedBaseline: EffectiveDailySkinItem[];
};
export type BaselineOverrideSelection = "inherit" | "absent" | "usual" | "more_than_usual" | "less_than_usual";

type BaselineSpec = Pick<EffectiveDailySkinItem, "key" | "concern" | "area" | "grade">;

/**
 * Pure read model: Profile establishes defaults; a durable daily fact overrides
 * the comparable default; a manual daily fact takes precedence over conversation.
 * It never materializes inherited defaults into daily_state.
 */
export function buildEffectiveDailySkinState(input: {
  checkin: SkinCheckin;
  profile: Pick<Profile, "long_term_skin_baseline"> | null;
}): EffectiveDailySkinState {
  const concerns = input.checkin.daily_state?.version === 2 ? input.checkin.daily_state.concerns.filter(isSemanticallyValidDailyConcern) : [];
  const metrics = buildDailySkinMetricSnapshot(input.checkin).metrics;
  const metricByConcern = new Map(concerns.map((concern, index) => [concern, metrics[index]?.grade ?? null]));
  const baselines = baselineSpecs(input.profile);
  const consumed = new Set<DailyStateConcern>();
  const items = baselines.map((baseline) => {
    const matches = concerns.filter((concern) => comparable(concern, baseline));
    const selected = matches.find(isManual) ?? matches.at(-1) ?? null;
    if (!selected) return { ...baseline, status: "present" as const, baselineComparison: null, provenance: "baseline_inherited" as const, todayConcern: null };
    consumed.add(selected);
    return fromTodayConcern(selected, metricByConcern.get(selected) ?? null, baseline);
  });

  concerns.forEach((concern) => {
    if (consumed.has(concern)) return;
    const area = concern.areas.find((item) => item !== "full_face") ?? concern.areas[0]!;
    items.push(fromTodayConcern(concern, metricByConcern.get(concern) ?? null, {
      key: `${concern.kind}:${area}`,
      concern: concern.kind,
      area,
      grade: null,
    }));
  });
  const todayOverrides = items.filter((item) => item.provenance === "manual_override" || item.provenance === "today_confirmed");
  return { items, todayOverrides, inheritedBaseline: items.filter((item) => item.provenance === "baseline_inherited") };
}

export function baselineSpecs(profile: Pick<Profile, "long_term_skin_baseline"> | null): BaselineSpec[] {
  if (!profile) return [];
  const baseline = profile.long_term_skin_baseline;
  const specs: BaselineSpec[] = [
    ...baseline.usual_oily_areas.map((area) => ({ key: `oiliness:${area}`, concern: "oiliness" as const, area, grade: null })),
    ...baseline.usual_dry_areas.map((area) => ({ key: `dryness:${area}`, concern: "dryness" as const, area, grade: null })),
    ...baseline.recurring_tendencies.flatMap((tendency) => {
      if (tendency.kind === "reactive_discomfort") return [];
      const concern = tendency.kind as DailyStateConcernKind;
      return tendency.usual_areas.map((area) => ({ key: `${concern}:${area}`, concern, area, grade: gradeForUsualIntensity(tendency.usual_intensity) }));
    }),
  ];
  return [...new Map(specs.map((item) => [item.key, item])).values()];
}

/** Applies an editor selection without copying the inherited baseline into daily_state. */
export function applyBaselineOverrideSelection(concerns: DailyStateConcern[], baseline: Pick<BaselineSpec, "concern" | "area">, selection: BaselineOverrideSelection): DailyStateConcern[] {
  const matching = (concern: DailyStateConcern) => concern.kind === baseline.concern && concern.areas.includes(baseline.area);
  const hasManual = concerns.some((concern) => matching(concern) && isManual(concern));
  if (selection === "inherit") return hasManual ? concerns.filter((concern) => !matching(concern)) : concerns;
  const status = selection === "absent" ? "absent" : "present";
  return [...concerns.filter((concern) => !matching(concern) || !isManual(concern)), {
    kind: baseline.concern,
    status,
    areas: [baseline.area],
    attributes: { severity: "mild", baseline_comparison: selection === "absent" || selection === "usual" ? "usual" : selection },
    user_wording: [], source: ["manual"], interaction_origin: "unknown", area_origin: "user_confirmed",
  }];
}

/** Completion language closes a conversation; it never represents a skin concern. */
export function isSemanticallyValidDailyConcern(concern: DailyStateConcern) {
  return !concern.user_wording.some((wording) => /^(没有了|没了|没别的|没有别的|就这些|差不多了|差不多就这些|先这样|可以了|可以整理了|没有其他(?:了)?|没其他(?:了)?|没有更多(?:了)?)[。！!，,\s]*$/u.test(wording.trim()));
}

function fromTodayConcern(concern: DailyStateConcern, grade: SkinGrade | null, baseline: BaselineSpec): EffectiveDailySkinItem {
  return {
    ...baseline,
    status: concern.status,
    grade: concern.status === "absent" ? 0 : grade,
    baselineComparison: concern.attributes.baseline_comparison ?? null,
    provenance: isManual(concern) ? "manual_override" : "today_confirmed",
    todayConcern: concern,
  };
}
function comparable(concern: DailyStateConcern, baseline: BaselineSpec) { return concern.kind === baseline.concern && concern.areas.includes(baseline.area); }
function isManual(concern: DailyStateConcern) { return concern.source.includes("manual"); }
function gradeForUsualIntensity(value: Profile["long_term_skin_baseline"]["recurring_tendencies"][number]["usual_intensity"]): SkinGrade | null { return value === "slight" ? 1 : value === "noticeable" ? 2 : value === "marked" ? 3 : value === "very_marked" ? 4 : null; }
