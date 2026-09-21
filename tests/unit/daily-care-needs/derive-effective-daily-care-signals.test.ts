import { describe, expect, it } from "vitest";

import type { DailySkinMetricSnapshot } from "@/domain/skin-grading/daily-skin-metric-snapshot";
import { deriveDailyCareNeeds } from "@/server/domain/daily-care-needs";
import { deriveEffectiveDailyCareSignals } from "@/server/domain/daily-care-needs/derive-effective-daily-care-signals";

describe("effective daily care signals", () => {
  it("uses reliable rich dryness once, producing the existing hydration and barrier needs", () => {
    const effective = resolve(snapshot(metric("dryness", 3)));
    const needs = derive(effective.checkin);

    expect(effective.checkin.drynessLevel).toBe(3);
    expect(effective.provenance.drynessLevel.source).toBe("rich");
    expect(needs.priorities.map((item) => item.code)).toEqual([
      "hydration",
      "barrier_support",
    ]);
  });

  it("uses rich oiliness without retaining a second canonical signal", () => {
    const effective = resolve(snapshot(metric("oiliness", 4)), {
      oilinessLevel: 3,
    });

    expect(effective.checkin.oilinessLevel).toBe(4);
    expect(effective.provenance.oilinessLevel.source).toBe("rich");
    expect(derive(effective.checkin).priorities).toEqual([
      expect.objectContaining({ code: "oil_balance" }),
    ]);
  });

  it("routes reliable rich redness through the existing soothing and gentle-routine semantics", () => {
    const needs = derive(resolve(snapshot(metric("redness", 3))).checkin);

    expect(needs.priorities).toEqual([
      expect.objectContaining({ code: "soothing" }),
    ]);
    expect(needs.restrictions).toEqual([
      expect.objectContaining({ code: "PREFER_GENTLE_ROUTINE" }),
    ]);
  });

  it("folds a qualifying user-raised reactive concern into one high sensitivity signal", () => {
    const effective = resolve(snapshot(metric("stinging", 3)));
    const needs = derive(effective.checkin);

    expect(effective.checkin.sensitivityLevel).toBe(3);
    expect(needs.priorities.map((item) => item.code)).toEqual([
      "barrier_support",
      "soothing",
    ]);
    expect(needs.restrictions).toEqual([
      expect.objectContaining({ code: "REDUCE_TREATMENT" }),
    ]);
  });

  it("does not turn assistant-prompted reactive evidence into a hard behavior", () => {
    const effective = resolve(snapshot(metric("stinging", 3, "assistant_prompted")), {
      sensitivityLevel: 1,
    });

    expect(effective.checkin.sensitivityLevel).toBe(1);
    expect(effective.provenance.sensitivityLevel.source).toBe("canonical");
  });

  it("falls back for unknown, missing, and absent rich metrics without treating them as zero", () => {
    const canonical = { drynessLevel: 4 } as const;
    for (const value of [
      snapshot({ ...metric("dryness", 3), grade_status: "unknown", grade: null }),
      snapshot(),
      snapshot({ ...metric("dryness", 0), daily_status: "absent" }),
    ]) {
      const effective = resolve(value, canonical);
      expect(effective.checkin.drynessLevel).toBe(4);
      expect(effective.provenance.drynessLevel.source).toBe("canonical");
    }
  });

  it("keeps canonical and rich high dryness as one resolved signal", () => {
    const effective = resolve(snapshot(metric("dryness", 3)), {
      drynessLevel: 4,
    });

    expect(effective.checkin.drynessLevel).toBe(3);
    expect(derive(effective.checkin).priorities).toHaveLength(2);
  });
});

function resolve(
  value: DailySkinMetricSnapshot | null,
  canonical = {},
) {
  return deriveEffectiveDailyCareSignals({
    snapshot: value,
    canonicalCheckin: canonical,
  });
}

function derive(checkin: ReturnType<typeof resolve>["checkin"]) {
  return deriveDailyCareNeeds({
    routineDate: "2026-09-05",
    period: "am",
    profile: null,
    checkin,
    weather: null,
    history: null,
  });
}

function snapshot(...metrics: DailySkinMetricSnapshot["metrics"]): DailySkinMetricSnapshot {
  return { date: "2026-09-05", metrics };
}

function metric(
  concern: DailySkinMetricSnapshot["metrics"][number]["concern"],
  grade: 0 | 1 | 2 | 3 | 4,
  evidence_origin: "user_raised" | "assistant_prompted" | "unknown" = "user_raised",
): DailySkinMetricSnapshot["metrics"][number] {
  return {
    concern,
    area: "cheeks",
    daily_status: "present",
    grade_status: "graded",
    grade,
    baseline_comparison: "usual",
    evidence_origin,
  };
}
