import type {
  DailySkinMetric,
  DailySkinMetricSnapshot,
} from "@/domain/skin-grading/daily-skin-metric-snapshot";

import type {
  DailyCareLevel,
  DailyCareNeedsCheckin,
} from "./types";

type EffectiveSignalName =
  | "drynessLevel"
  | "oilinessLevel"
  | "rednessLevel"
  | "sensitivityLevel";

type EffectiveSignalEvidence = Pick<
  DailySkinMetric,
  | "concern"
  | "area"
  | "daily_status"
  | "grade_status"
  | "grade"
  | "baseline_comparison"
  | "evidence_origin"
>;

export type EffectiveDailyCareSignalProvenance = {
  source: "rich" | "canonical" | "canonical_and_rich" | "unknown";
  canonicalLevel: DailyCareLevel | undefined;
  richEvidence: EffectiveSignalEvidence[];
};

export type EffectiveDailyCareSignals = {
  checkin: DailyCareNeedsCheckin;
  provenance: Record<
    EffectiveSignalName,
    EffectiveDailyCareSignalProvenance
  >;
};

export type EffectiveDailyCareSignalsInput = {
  snapshot: DailySkinMetricSnapshot | null;
  canonicalCheckin: DailyCareNeedsCheckin;
};

const DIRECT_CONCERN_BY_SIGNAL = {
  drynessLevel: "dryness",
  oilinessLevel: "oiliness",
  rednessLevel: "redness",
} as const;

/**
 * Resolves rich daily observations into the existing canonical check-in
 * vocabulary before DailyCareNeeds is derived. It intentionally ignores rich
 * absences: v0.1 has no cross-source conflict-resolution policy.
 */
export function deriveEffectiveDailyCareSignals(
  input: EffectiveDailyCareSignalsInput,
): EffectiveDailyCareSignals {
  const direct = Object.fromEntries(
    (Object.entries(DIRECT_CONCERN_BY_SIGNAL) as Array<
      [Exclude<EffectiveSignalName, "sensitivityLevel">, DailySkinMetric["concern"]]
    >).map(([signal, concern]) => [
      signal,
      resolveDirectSignal(input.snapshot, concern, input.canonicalCheckin[signal]),
    ]),
  ) as Record<
    Exclude<EffectiveSignalName, "sensitivityLevel">,
    { level: DailyCareLevel | undefined; provenance: EffectiveDailyCareSignalProvenance }
  >;
  const sensitivity = resolveSensitivitySignal(
    input.snapshot,
    input.canonicalCheckin.sensitivityLevel,
  );

  return {
    checkin: {
      ...(direct.drynessLevel.level === undefined
        ? {}
        : { drynessLevel: direct.drynessLevel.level }),
      ...(direct.oilinessLevel.level === undefined
        ? {}
        : { oilinessLevel: direct.oilinessLevel.level }),
      ...(direct.rednessLevel.level === undefined
        ? {}
        : { rednessLevel: direct.rednessLevel.level }),
      ...(sensitivity.level === undefined
        ? {}
        : { sensitivityLevel: sensitivity.level }),
      ...(input.canonicalCheckin.acneLevel === undefined
        ? {}
        : { acneLevel: input.canonicalCheckin.acneLevel }),
    },
    provenance: {
      drynessLevel: direct.drynessLevel.provenance,
      oilinessLevel: direct.oilinessLevel.provenance,
      rednessLevel: direct.rednessLevel.provenance,
      sensitivityLevel: sensitivity.provenance,
    },
  };
}

function resolveDirectSignal(
  snapshot: DailySkinMetricSnapshot | null,
  concern: DailySkinMetric["concern"],
  canonicalLevel: DailyCareLevel | undefined,
) {
  const richEvidence = reliablePresentMetrics(snapshot, concern);
  const richLevel = highestGrade(richEvidence);
  if (richLevel !== undefined) {
    return {
      level: richLevel,
      provenance: {
        source: "rich" as const,
        canonicalLevel,
        richEvidence,
      },
    };
  }
  return canonicalFallback(canonicalLevel);
}

function resolveSensitivitySignal(
  snapshot: DailySkinMetricSnapshot | null,
  canonicalLevel: DailyCareLevel | undefined,
) {
  const richEvidence = (snapshot?.metrics ?? []).filter(isQualifyingReactiveMetric);
  const richLevel = highestGrade(richEvidence);
  if (richLevel === undefined) return canonicalFallback(canonicalLevel);

  if (canonicalLevel === undefined) {
    return {
      level: richLevel,
      provenance: {
        source: "rich" as const,
        canonicalLevel,
        richEvidence,
      },
    };
  }

  const level = Math.max(canonicalLevel, richLevel) as DailyCareLevel;
  return {
    level,
    provenance: {
      source: "canonical_and_rich" as const,
      canonicalLevel,
      richEvidence,
    },
  };
}

function canonicalFallback(canonicalLevel: DailyCareLevel | undefined) {
  return {
    level: canonicalLevel,
    provenance: {
      source: canonicalLevel === undefined ? "unknown" as const : "canonical" as const,
      canonicalLevel,
      richEvidence: [],
    },
  };
}

function reliablePresentMetrics(
  snapshot: DailySkinMetricSnapshot | null,
  concern: DailySkinMetric["concern"],
) {
  return (snapshot?.metrics ?? []).filter((metric) =>
    metric.concern === concern
    && metric.daily_status === "present"
    && metric.grade_status === "graded"
    && metric.grade !== null
    && metric.evidence_origin !== "unknown"
  );
}

function isQualifyingReactiveMetric(metric: DailySkinMetric) {
  return (
    ["stinging", "itching", "burning"].includes(metric.concern)
    && metric.daily_status === "present"
    && metric.grade_status === "graded"
    && metric.grade !== null
    && metric.grade >= 3
    && metric.evidence_origin === "user_raised"
  );
}

function highestGrade(metrics: EffectiveSignalEvidence[]) {
  const grades = metrics.flatMap((metric) => metric.grade === null ? [] : [metric.grade]);
  return grades.length ? Math.max(...grades) as DailyCareLevel : undefined;
}
