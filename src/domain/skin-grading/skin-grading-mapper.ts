import { SKIN_GRADING_CONFIG } from "./skin-grading-config";
import type { GradedSkinResult, ResolvedSkinGrade, SkinGrade, SkinGradeConfidence, SkinGradeManualOverride, SkinGradeResult, SkinGradingInput } from "./skin-grading-types";

export function gradeDailySkinConcern(input: SkinGradingInput): SkinGradeResult {
  const definition = SKIN_GRADING_CONFIG[input.kind];
  if (input.status === "absent") return graded(input, 0, "high", ["已确认今天无该 concern 表现"], "明确的 absent 状态对应规范的 0 级。 ");
  if (definition.family === "composite") return gradeComposite(input);
  return gradeDirect(input);
}

/** Keeps automatic evidence intact while letting a future edit layer choose the presentation. */
export function resolveSkinGrade(automatic: SkinGradeResult, manualOverride?: SkinGradeManualOverride): ResolvedSkinGrade {
  if (!manualOverride) return { automatic, presentation: automatic, provenance: "automatic" };
  if (manualOverride.status === "unknown") return {
    automatic,
    presentation: { status: "unknown", concern: automatic.concern, reason: manualOverride.reason },
    provenance: "manual",
  };
  const definition = SKIN_GRADING_CONFIG[automatic.concern];
  const anchor = definition.anchors[manualOverride.grade];
  return {
    automatic,
    presentation: {
      status: "graded",
      concern: automatic.concern,
      grade: manualOverride.grade,
      label: anchor.label,
      anchor_id: `manual_override.${anchor.id}`,
      confidence: "high",
      evidence: ["用户手动确认展示等级"],
      rationale: "手动确认优先于自动 presentation mapping；自动结果与其证据仍保留。",
    },
    provenance: "manual",
  };
}

function gradeDirect(input: SkinGradingInput): SkinGradeResult {
  const severity = input.attributes.severity;
  if (!severity) return unknown(input, "当前 concern 已确认存在，但现有事实没有可映射到规范锚点的 observable severity。");
  if (onlyUnconfirmedFullFace(input)) return unknown(input, "只有未经确认的 full_face fallback，不能作为范围或程度证据。");

  const broad = hasConfirmedBroadArea(input);
  const persistent = input.attributes.duration === "all_day" || input.attributes.duration === "several_days" || input.attributes.persistence === "persistent" || input.attributes.persistence === "recurrent";
  const grade: SkinGrade = severity === "slight" ? 1
    : severity === "mild" ? 2
      : severity === "moderate" ? (broad || persistent ? 3 : 2)
        : (broad && persistent ? 4 : 3);
  const evidence = [`severity=${severity}`];
  if (broad) evidence.push("已确认多个区域或全脸范围");
  if (persistent) evidence.push("已确认持续/反复时间信息");
  const confidence: SkinGradeConfidence = broad && persistent ? "high" : severity === "slight" ? "low" : "medium";
  return graded(input, grade, confidence, evidence, "按 concern-specific ordinal anchor，以现有直接观察的程度、范围和持续性保守映射。");
}

function gradeComposite(input: SkinGradingInput): SkinGradeResult {
  const amount = input.attributes.amount;
  const distribution = input.attributes.distribution;
  if (!amount || !distribution) return unknown(input, "复合 concern 需要已确认的 amount 与 extent/distribution；缺失不能补为无明显表现。");
  if (onlyUnconfirmedFullFace(input) && distribution !== "widespread") return unknown(input, "未经确认的 full_face fallback 不能替代 extent evidence。");

  const grade = compositeGrade(amount, distribution);
  if (grade === null) return unknown(input, "现有 amount 与 extent/distribution 组合不能可靠映射为规范 presentation grade。");
  const confidence: SkinGradeConfidence = amount === "widespread" && distribution === "widespread" ? "high" : "medium";
  return graded(input, grade, confidence, [`amount=${amount}`, `distribution=${distribution}`], "按规范以已确认的 amount + extent/distribution 保守映射；concern kind 仅确定已确认的观察类别，不单独决定等级。");
}

function compositeGrade(amount: NonNullable<SkinGradingInput["attributes"]["amount"]>, distribution: NonNullable<SkinGradingInput["attributes"]["distribution"]>): SkinGrade | null {
  if (distribution === "widespread") {
    if (amount === "many" || amount === "widespread") return 4;
    if (amount === "several") return 3;
    return 2;
  }
  if (amount === "widespread") return null;
  if (amount === "many") return 3;
  if (amount === "several") return distribution === "localized" || distribution === "clustered" ? 2 : 3;
  if (amount === "few" || amount === "isolated") return distribution === "scattered" ? 2 : 1;
  return null;
}

function hasConfirmedBroadArea(input: SkinGradingInput) {
  return input.areas.filter((area) => area !== "full_face").length >= 2 || (input.areas.includes("full_face") && input.area_origin === "user_confirmed");
}

function onlyUnconfirmedFullFace(input: SkinGradingInput) {
  return input.areas.length === 1 && input.areas[0] === "full_face" && input.area_origin !== "user_confirmed";
}

function graded(input: SkinGradingInput, grade: SkinGrade, confidence: SkinGradeConfidence, evidence: string[], rationale: string): GradedSkinResult {
  const anchor = SKIN_GRADING_CONFIG[input.kind].anchors[grade];
  return { status: "graded", concern: input.kind, grade, label: anchor.label, anchor_id: anchor.id, confidence, evidence, rationale };
}

function unknown(input: SkinGradingInput, reason: string): SkinGradeResult {
  return { status: "unknown", concern: input.kind, reason };
}
