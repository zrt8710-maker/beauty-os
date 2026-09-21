import { describe, expect, it } from "vitest";

import { gradeDailySkinConcern, resolveSkinGrade } from "@/domain/skin-grading/skin-grading-mapper";
import type { SkinGradingInput } from "@/domain/skin-grading/skin-grading-types";

const concern = (patch: Partial<SkinGradingInput> = {}): SkinGradingInput => ({
  kind: "oiliness",
  status: "present",
  areas: ["t_zone"],
  attributes: {},
  area_origin: "user_confirmed",
  ...patch,
});

describe("Skin Grading Mapper", () => {
  it("maps explicit oiliness absence to grade 0", () => {
    expect(gradeDailySkinConcern(concern({ status: "absent" }))).toMatchObject({ status: "graded", grade: 0, label: "无明显表现", anchor_id: "oiliness.grade_0" });
  });

  it("maps local slight and local obvious oiliness conservatively", () => {
    expect(gradeDailySkinConcern(concern({ attributes: { severity: "slight" } }))).toMatchObject({ status: "graded", grade: 1, anchor_id: "oiliness.grade_1" });
    expect(gradeDailySkinConcern(concern({ attributes: { severity: "moderate" } }))).toMatchObject({ status: "graded", grade: 2, anchor_id: "oiliness.grade_2" });
  });

  it("requires breadth and persistence before assigning the strongest oiliness anchor", () => {
    expect(gradeDailySkinConcern(concern({ areas: ["t_zone", "cheeks"], attributes: { severity: "marked", duration: "all_day" } }))).toMatchObject({ status: "graded", grade: 4, confidence: "high" });
    expect(gradeDailySkinConcern(concern({ attributes: { severity: "marked" } }))).toMatchObject({ status: "graded", grade: 3 });
  });

  it("does not infer a direct grade from missing evidence, a profile-like baseline, or roughness/flaking facts", () => {
    expect(gradeDailySkinConcern(concern())).toMatchObject({ status: "unknown" });
    expect(gradeDailySkinConcern(concern({ attributes: { baseline_comparison: "more_than_usual" } }))).toMatchObject({ status: "unknown" });
    expect(gradeDailySkinConcern(concern({ kind: "dryness", attributes: { duration: "all_day" } }))).toMatchObject({ status: "unknown" });
  });

  it("maps direct dryness and redness only from their own observable severity", () => {
    expect(gradeDailySkinConcern(concern({ kind: "dryness", attributes: { severity: "slight", duration: "transient" } }))).toMatchObject({ status: "graded", grade: 1 });
    expect(gradeDailySkinConcern(concern({ kind: "flaking", attributes: { severity: "moderate" } }))).toMatchObject({ status: "graded", grade: 2 });
    expect(gradeDailySkinConcern(concern({ kind: "roughness", areas: ["cheeks", "chin"], attributes: { severity: "marked", persistence: "persistent" } }))).toMatchObject({ status: "graded", grade: 4 });
    expect(gradeDailySkinConcern(concern({ kind: "redness", areas: ["cheeks", "nose"], attributes: { severity: "moderate", persistence: "persistent" } }))).toMatchObject({ status: "graded", grade: 3 });
  });

  it("maps reactive discomfort without borrowing redness or another discomfort type", () => {
    expect(gradeDailySkinConcern(concern({ kind: "stinging", attributes: { severity: "slight", duration: "transient" } }))).toMatchObject({ status: "graded", grade: 1 });
    expect(gradeDailySkinConcern(concern({ kind: "itching", attributes: { severity: "moderate", persistence: "recurrent" } }))).toMatchObject({ status: "graded", grade: 3 });
    expect(gradeDailySkinConcern(concern({ kind: "burning", attributes: { severity: "marked", duration: "all_day" } }))).toMatchObject({ status: "graded", grade: 3 });
  });

  it("maps composite concerns from amount plus distribution, never from concern name alone", () => {
    expect(gradeDailySkinConcern(concern({ kind: "blackheads", areas: ["nose"], attributes: { amount: "few", distribution: "localized" } }))).toMatchObject({ status: "graded", grade: 1, anchor_id: "blackheads.grade_1" });
    expect(gradeDailySkinConcern(concern({ kind: "small_bumps", areas: ["forehead"], attributes: { amount: "several", distribution: "clustered" } }))).toMatchObject({ status: "graded", grade: 2 });
    expect(gradeDailySkinConcern(concern({ kind: "blemishes", areas: ["cheeks", "chin"], attributes: { amount: "many", distribution: "scattered", tenderness: "present" } }))).toMatchObject({ status: "graded", grade: 3 });
    expect(gradeDailySkinConcern(concern({ kind: "visible_pores", areas: ["nose", "cheeks"], attributes: { amount: "many", distribution: "widespread" } }))).toMatchObject({ status: "graded", grade: 4 });
  });

  it("returns unknown for incomplete composite facts and does not let a full-face fallback increase grade", () => {
    expect(gradeDailySkinConcern(concern({ kind: "blackheads", attributes: { amount: "few" } }))).toMatchObject({ status: "unknown" });
    expect(gradeDailySkinConcern(concern({ kind: "visible_pores", areas: ["full_face"], area_origin: "unknown", attributes: { amount: "many", distribution: "localized" } }))).toMatchObject({ status: "unknown" });
    expect(gradeDailySkinConcern(concern({ areas: ["full_face"], area_origin: "unknown", attributes: { severity: "marked", duration: "all_day" } }))).toMatchObject({ status: "unknown" });
  });

  it("preserves automatic evidence while a future manual override controls presentation", () => {
    const automatic = gradeDailySkinConcern(concern({ attributes: { severity: "slight" } }));
    const resolved = resolveSkinGrade(automatic, { status: "graded", grade: 3 });
    expect(resolved).toMatchObject({ provenance: "manual", automatic: { status: "graded", grade: 1 }, presentation: { status: "graded", grade: 3, anchor_id: "manual_override.oiliness.grade_3" } });
  });
});
