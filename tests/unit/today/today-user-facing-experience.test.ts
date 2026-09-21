import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayRoutine, todayGenerateRequestBody } from "@/features/today/today-routine";
import {
  buildTodayRoutineViewModel,
  userFacingExcludedProducts,
} from "@/features/today/today-routine-view-model";
import type { Routine } from "@/schemas/routine";

describe("Today user-facing experience", () => {
  it("sends force only from an explicit existing-routine regeneration action", () => {
    expect(todayGenerateRequestBody("am", false)).toEqual({ period: "am" });
    expect(todayGenerateRequestBody("pm", true)).toEqual({ period: "pm", forceRegenerate: true });
    const source = readFileSync(fileURLToPath(new URL("../../../src/features/today/today-routine.tsx", import.meta.url)), "utf8");
    expect(source).toContain("onGenerate={() => generate(false)}");
    expect(source).toContain("onForceGenerate={() => generate(true)}");
    expect(source).toContain("<RoutineSteps busy={busy} onGenerate={() => generate(false)}");
    expect(source).not.toContain("onGenerate={() => generate(true)}");
  });

  it("uses the persisted LLM why_today when it is consumer-safe", () => {
    const model = buildTodayRoutineViewModel(plannerRoutine("pm"));
    expect(model?.steps[0]).toMatchObject({
      whyToday: "今晚需要温和完成清洁。",
      howToUse: "按产品说明取适量清洁即可；洗后不需要反复清洁。",
    });
    expect(JSON.stringify(model)).not.toMatch(/基础分|\+10|\+8|score/i);
  });

  it("uses saved selected-product facts without exposing their technical evidence metadata", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    decision.selectedProductEvidence = [{
      ownedProductId: "10000000-0000-4000-8000-000000000001",
      purpose: "cleansing",
      productType: "cleanser",
      relevantClaims: ["深层清洁", "洁面后清爽不紧绷"],
      relevantTextureFacts: ["膏状质地，揉搓后可产生丰富细腻的泡沫"],
      relevantUsageFacts: ["适合早晚使用"],
      relevantCautions: [],
    }];
    const step = buildTodayRoutineViewModel(routine)?.steps[0];
    expect(step?.whyThisProduct).toContain("深层清洁");
    expect(step?.whyThisProduct).toContain("膏状质地");
    expect(JSON.stringify(step)).not.toMatch(/source-|draft|confidence|evidence/i);
  });

  it("uses validated Planner rationale before the low-value product-fact fallback when narration is unavailable", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    const selected = decision.selected_steps as Array<Record<string, unknown>>;
    selected[0] = {
      ...selected[0],
      selection_rationale: {
        candidateIds: ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"],
        selectedProductId: "10000000-0000-4000-8000-000000000001",
        relevantDifferences: ["洗后不紧绷的描述更符合今晚保持温和的安排。"],
        whySelectedToday: "今晚需要完成清洁，也要兼顾鼻翼容易干的状态。",
        certainty: "clear",
        comparisonMode: "strong",
      },
    };

    const step = buildTodayRoutineViewModel(routine)?.steps[0];
    expect(step?.reason).toBe("今晚需要完成清洁，也要兼顾鼻翼容易干的状态。");
    expect(step?.comparisonNote).toContain("洗后不紧绷");
    expect(step?.reason).not.toMatch(/配方中包含|可以承担这一步/u);
  });

  it("uses the saved narration to connect the local need with the selected product", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    decision.consumerNarrative = { entries: [{
      ownedProductId: "10000000-0000-4000-8000-000000000001",
      reason: "你平时 T 区容易出油，今晚先把清洁做得恰到好处。这支洁面有洁后不紧绷相关描述，适合兼顾鼻翼容易干的状态。",
      comparison_note: "至本更偏向日常面部清洁；POLA 有明确的泡沫与洗后水润感，所以今晚更偏向 POLA。",
      usage: "取适量加水起泡后轻柔清洁，再用清水洗净即可。",
    }] };

    const step = buildTodayRoutineViewModel(routine)?.steps[0];
    expect(step).toMatchObject({ reason: "你平时 T 区容易出油，今晚先把清洁做得恰到好处。这支洁面有洁后不紧绷相关描述，适合兼顾鼻翼容易干的状态。", comparisonNote: "至本更偏向日常面部清洁；POLA 有明确的泡沫与洗后水润感，所以今晚更偏向 POLA。", usage: "取适量加水起泡后轻柔清洁，再用清水洗净即可。" });
  });

  it("keeps only today-specific safety exclusions", () => {
    const routine = { excluded_products: [
      { reason_code: "PRODUCT_EXPIRED", reason: "internal", product_name: "A" },
      { reason_code: "UNSUPPORTED_PRODUCT_TYPE", reason: "internal", product_name: "B" },
      { reason_code: "ROLE_NOT_SELECTED", reason: "internal", product_name: "C" },
      { reason_code: "AVOID_INGREDIENT_MATCH", reason: "internal", product_name: "D" },
      { reason_code: "RECENT_HIGH_REACTION_HARD_BLOCK", reason: "internal", product_name: "E" },
    ] } as Routine;
    expect(userFacingExcludedProducts(routine)).toEqual([
      expect.objectContaining({ product_name: "D", reason: "与你设置的避用成分存在明确匹配，今天先不要使用。" }),
      expect.objectContaining({ product_name: "E", reason: "近期使用后记录过明显不适，今天建议先暂停。" }),
    ]);
  });

  it("frames unresolved needs as an existing-product gap rather than a purchase suggestion", () => {
    expect(buildTodayRoutineViewModel(plannerRoutine("pm"))?.unresolvedNeeds[0]).toMatchObject({
      whatIsMissing: "现有产品里暂时没有合适的基础保湿收尾",
      urgency: "helpful_if_needed",
    });
    expect(buildTodayRoutineViewModel(plannerRoutine("am"))?.unresolvedNeeds[0]).toMatchObject({
      whatIsMissing: "现有产品里暂时没有合适的防晒步骤",
      urgency: "needed_today",
    });
    const pmWithSunNeed = plannerRoutine("pm");
    const pmDecision = pmWithSunNeed.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    pmDecision.unresolved_needs = ["sun_protection candidate unavailable"];
    expect(buildTodayRoutineViewModel(pmWithSunNeed)?.unresolvedNeeds).toEqual([]);
  });

  it("removes the old coverage and default-unused modules from the page", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../src/features/today/today-routine.tsx", import.meta.url)), "utf8");
    expect(source).not.toContain("今日护理覆盖");
    expect(source).not.toContain("你的现有产品");
    expect(source).not.toContain("今天暂未使用的产品");
    expect(source).not.toContain("使用历史已保存，将用于后续规则评分");
  });

  it("renders only reason and usage for each step while retaining technical audit fields off screen", () => {
    const routine = plannerRoutine("pm");
    const html = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutine: routine, context: { skinStatus: "今天已记录：干燥", environment: "成都 · 22°C" } }));
    expect(html).toContain("今晚保持精简，兼顾清洁与补水。");
    expect(html).toContain("为什么选这瓶");
    expect(html).toContain("怎么用");
    expect(html).toContain("资料确认它可用于洁面。");
    expect(html).not.toContain("其他产品可以承担");
    expect(html).not.toContain("本次先选这一瓶");
    expect(html).toContain("你平时T 区出油");
    expect(html).toContain("温度 28℃ · 湿度 68% · UV 7；今天的环境已纳入方案，但没有带来明显额外调整。");
    expect(html).toContain("现有产品里暂时没有合适的基础保湿收尾");
    expect(html).toContain("今天先保持精简即可，不需要为了补齐步骤临时增加产品。");
    expect(html).not.toContain("可以考虑：");
    expect(html).not.toContain("今天先不用");
    expect(html).not.toContain("今天更倾向这瓶：");
    expect(html).not.toContain("今天已记录：干燥");
    expect(html).not.toContain("成都 · 22°C");
    expect(html).not.toMatch(/基础分|\+10|\+8|evidence ref|signal id|validator|provider|draft_derived|supportedPurposes|eligibleProducts|目前还不能确定|无法证明明显优劣|未经过独立验证|成分未知|数据不足|confidence/i);
  });

  it("presents deterministic fallback as a basic arrangement without a fabricated product explanation", () => {
    const routine = plannerRoutine("pm");
    routine.decision_snapshot!.planner = {
      version: 1,
      generationSource: "deterministic_fallback",
      strategy: null,
      strategySummary: null,
      structuredDecision: { validatorResult: "not_run", fallbackReason: "CARE_PLANNER_UNAVAILABLE" },
    };

    const model = buildTodayRoutineViewModel(routine);
    const html = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutine: routine, context: { skinStatus: "已记录", environment: "晴" } }));

    expect(model).toMatchObject({
      generationSource: "deterministic_fallback",
      headline: "本次智能方案暂未生成成功，当前展示基础护理安排。",
      steps: [expect.objectContaining({ reason: null, comparisonNote: null, whyThisProduct: null })],
    });
    expect(html).toContain("本次智能方案暂未生成成功，当前展示基础护理安排。");
    expect(html).not.toContain("它符合本次已保存的护理安排。");
    expect(html).not.toContain("为什么选这瓶");
  });

  it("shows only persisted purpose-level omissions in the top-level routine explanation", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    decision.purposeOmissions = [{ purpose: "hydration_support", reason: "not_needed_today" }];
    decision.consumerNarrative = {
      entries: [],
      purposeOmissions: [{
        purpose: "hydration_support",
        reason: "not_needed_today",
        message: "今天没有额外加入补水步骤，当前方案已经覆盖主要护理方向。",
      }],
    };

    expect(buildTodayRoutineViewModel(routine)?.purposeOmissions).toEqual([{
      purposeLabel: "补水",
      message: "今天没有额外加入补水步骤，当前方案已经覆盖主要护理方向。",
    }]);

    decision.purposeOmissions = [{ purpose: "cleansing", reason: "not_needed_today" }];
    expect(buildTodayRoutineViewModel(routine)?.purposeOmissions).toEqual([]);
  });

  it("shows only existing consumer-safe exclusions under 今天先不用", () => {
    const routine = plannerRoutine("pm");
    routine.excluded_products = [
      { owned_product_id: "10000000-0000-4000-8000-000000000010", product_id: "10000000-0000-4000-8000-000000000011", brand_name: "A", product_name: "避用成分产品", reason_code: "AVOID_INGREDIENT_MATCH", reason: "internal", },
      { owned_product_id: "10000000-0000-4000-8000-000000000012", product_id: "10000000-0000-4000-8000-000000000013", brand_name: "B", product_name: "近期不适产品", reason_code: "RECENT_HIGH_REACTION_HARD_BLOCK", reason: "internal", },
      { owned_product_id: "10000000-0000-4000-8000-000000000014", product_id: "10000000-0000-4000-8000-000000000015", brand_name: "C", product_name: "同类候选", reason_code: "DUPLICATE_ROLE_REMOVED", reason: "internal", },
    ];

    const html = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutine: routine, context: { skinStatus: "已记录", environment: "晴" } }));
    expect(html).toContain("今天先不用");
    expect(html).toContain("避用成分产品");
    expect(html).toContain("近期不适产品");
    expect(html).not.toContain("同类候选");
    expect(html).not.toContain("AVOID_INGREDIENT_MATCH");
    expect(html).not.toContain("RECENT_HIGH_REACTION_HARD_BLOCK");
    expect(html).not.toContain("DUPLICATE_ROLE_REMOVED");
  });

  it("makes a saved but unused weather snapshot transparent without inventing an effect", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    const assessments = decision.productFitAssessments as { selected: Array<Record<string, unknown>> };
    assessments.selected[0]!.relevantWeatherSignals = [];

    expect(buildTodayRoutineViewModel(routine)?.weatherContext).toBe("温度 28℃ · 湿度 68% · UV 7；当前保存的方案没有记录环境带来额外护理调整，主要依据今天的皮肤状态和已有产品安排。");
  });

  it("shows a weather effect only when saved decision text explicitly ties it to a selected step", () => {
    const routine = plannerRoutine("am");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    const selected = decision.selected_steps as Array<Record<string, unknown>>;
    selected[0]!.why_today = "今天紫外线较强，因此早间把防晒作为必要步骤。";
    const assessments = decision.productFitAssessments as { selected: Array<Record<string, unknown>> };
    assessments.selected[0]!.relevantWeatherSignals = ["weather:uv_index"];

    expect(buildTodayRoutineViewModel(routine)?.weatherContext).toContain("今天的环境对方案有实际影响：今天紫外线较强，因此早间把防晒作为必要步骤。");
  });

  it("opens an existing PM routine instead of showing the generate-first state", () => {
    const routine = {
      id: "20000000-0000-4000-8000-000000000001", period: "pm", status: "generated",
      explanation: { priorities: [], reasons: [], restrictions: [], capability_gaps: [] },
      decision_snapshot: { selectedSteps: [], capabilityGaps: [] },
      excluded_products: [], steps: [],
    } as unknown as Routine;
    const html = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutines: [routine], context: { skinStatus: "已记录", environment: "成都" } }));
    expect(html).toContain("晚间方案");
    expect(html).toContain("重新生成");
    expect(html).toContain("检查并更新");
    expect(html).toContain("完整重新生成");
    expect(html).not.toContain("先记录今天皮肤状态，再生成今日方案");
  });

  it("keeps AM and PM as independent workspace slots without a period select", () => {
    const pm = {
      id: "20000000-0000-4000-8000-000000000002", period: "pm", status: "generated",
      explanation: { priorities: [], reasons: [], restrictions: [], capability_gaps: [] },
      decision_snapshot: { selectedSteps: [], capabilityGaps: [] }, excluded_products: [], steps: [],
    } as unknown as Routine;
    const html = renderToStaticMarkup(createElement(TodayRoutine, {
      initialRoutines: [pm], activePeriod: "am", context: { skinStatus: "已记录", environment: "成都" },
    }));
    expect(html).toContain("AM 早间 · 未生成");
    expect(html).toContain("PM 晚间 · 已生成");
    expect(html).toContain("生成早间方案");
    expect(html).not.toContain("<select");
  });

  it("renders only the routine for the active Today route", () => {
    const routine = (period: "am" | "pm", productName: string) => ({
      id: `20000000-0000-4000-8000-00000000000${period === "am" ? "3" : "4"}`,
      period,
      status: "generated",
      weather_snapshot: {},
      explanation: { priorities: [], reasons: [], restrictions: [], capability_gaps: [] },
      decision_snapshot: { selectedSteps: [], capabilityGaps: [] },
      excluded_products: [],
      steps: [{ id: `${period}-step`, step_order: 1, owned_product_id: `${period}-product`, role: "cleanser", reason: "基础护理", product: { brand_name: null, product_name: productName } }],
    }) as unknown as Routine;
    const routines = [routine("am", "AM 专属产品"), routine("pm", "PM 专属产品")];
    const context = { skinStatus: "已记录", environment: "成都" };
    const amHtml = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutines: routines, activePeriod: "am", context }));
    const pmHtml = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutines: routines, activePeriod: "pm", context }));

    expect(amHtml).toContain("AM 专属产品");
    expect(amHtml).not.toContain("PM 专属产品");
    expect(pmHtml).toContain("PM 专属产品");
    expect(pmHtml).not.toContain("AM 专属产品");
    expect(amHtml).toContain('href="/today/pm"');
    expect(pmHtml).toContain('href="/today/am"');
  });

  it("derives feedback status from usage history identity without changing routine status", () => {
    const routine = {
      id: "20000000-0000-4000-8000-000000000005", period: "pm", status: "generated",
      explanation: { priorities: [], reasons: [], restrictions: [], capability_gaps: [] },
      decision_snapshot: { selectedSteps: [], capabilityGaps: [] }, excluded_products: [], steps: [],
    } as unknown as Routine;
    const unrecorded = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutines: [routine], activePeriod: "pm", context: { skinStatus: "已记录", environment: "成都" } }));
    const recorded = renderToStaticMarkup(createElement(TodayRoutine, { initialRoutines: [routine], initialFeedbackRoutineIds: [routine.id], activePeriod: "pm", context: { skinStatus: "已记录", environment: "成都" } }));

    expect(unrecorded).toContain("使用反馈 · 尚未记录");
    expect(recorded).toContain("使用反馈 · 已记录");
    expect(recorded).toContain(`routineId=${routine.id}&amp;period=pm`);
  });

  it.each([
    ["油皮 + 今天泛红", "skin:today_confirmed:redness:cheeks", "脸颊泛红"],
    ["干皮 + 今天稳定", "skin:baseline_inherited:dryness:cheeks", "脸颊干燥"],
    ["痘肌 + 今天无新痘", "skin:baseline_inherited:blemishes:chin", "下巴痘痘"],
    ["中性 + 今天突然长痘", "skin:today_confirmed:blemishes:chin", "下巴痘痘"],
    ["油皮 + 今天局部脱皮", "skin:today_confirmed:flaking:nose_wings", "鼻翼起皮"],
  ])("falls back to saved skin facts only when persisted why_today is not consumer-safe for %s", (_label, signal, expected) => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    const selected = decision.selected_steps as Array<Record<string, unknown>>;
    selected[0]!.why_today = "产品证据不足。";
    const assessments = decision.productFitAssessments as { selected: Array<Record<string, unknown>> };
    assessments.selected[0]!.relevantSkinSignals = [signal];
    const step = buildTodayRoutineViewModel(routine)?.steps[0];
    expect(step?.whyToday).toContain(expected);
  });

  it("uses persisted narration for a validated weather signal before reporting no adjustment", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    decision.consumerNarrative = { entries: [{
      ownedProductId: "10000000-0000-4000-8000-000000000001",
      reason: "今天湿度偏高，所以这一步保持轻薄即可。",
      comparison_note: null,
      usage: "按产品说明使用即可。",
    }] };
    expect(buildTodayRoutineViewModel(routine)?.weatherContext).toContain("今天的环境对方案有实际影响：今天湿度偏高，所以这一步保持轻薄即可。");
  });

  it("projects only the weather-specific sentence instead of a product narration paragraph", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    decision.consumerNarrative = { entries: [{
      ownedProductId: "10000000-0000-4000-8000-000000000001",
      reason: "今晚需要温和清洁，POLA 洁面的泡沫细腻，适合 T 区偏油和鼻翼偏干。今天湿度偏高，所以这一步保持轻薄即可。",
      comparison_note: null,
      usage: "按产品说明使用即可。",
    }] };

    const weather = buildTodayRoutineViewModel(routine)?.weatherContext;
    expect(weather).toContain("今天湿度偏高，所以这一步保持轻薄即可。");
    expect(weather).not.toContain("POLA");
    expect(weather).not.toContain("泡沫");
    expect(weather).not.toContain("鼻翼偏干");
  });

  it("does not turn a product paragraph mentioning normal weather into a weather adjustment", () => {
    const routine = plannerRoutine("pm");
    const decision = routine.decision_snapshot?.planner?.structuredDecision as Record<string, unknown>;
    const selected = decision.selected_steps as Array<Record<string, unknown>>;
    selected[0]!.why_today = "22℃、湿度适中时，POLA 洁面的泡沫肤感舒服，因此今晚保留清洁。";

    expect(buildTodayRoutineViewModel(routine)?.weatherContext).toBe("温度 28℃ · 湿度 68% · UV 7；今天的环境已纳入方案，但没有带来明显额外调整。");
  });

  it("keeps reuse and failure retention distinct from a successful regeneration", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../src/features/today/today-routine.tsx", import.meta.url)), "utf8");
    expect(source).toContain("当前方案仍适合今天，已继续沿用。");
    expect(source).toContain("本次更新未完成，已保留之前可安全使用的方案。");
    expect(source).toContain('generationResult === "retained_after_failure"');
    expect(source).toContain('generationResult === "retained_previous"');
  });
});

function plannerRoutine(period: "am" | "pm"): Routine {
  const ownedProductId = "10000000-0000-4000-8000-000000000001";
  return {
    id: "20000000-0000-4000-8000-000000000001", period, status: "generated",
    weather_snapshot: { temperature: 28, humidity: 68, uv_index: 7 }, skin_snapshot: {},
    explanation: { priorities: [], reasons: [], restrictions: [], capability_gaps: [] },
    decision_snapshot: {
      planner: { version: 1, generationSource: "llm", strategy: "balanced", strategySummary: period === "pm" ? "今晚保持精简，兼顾清洁与补水。" : "早间保持清爽，并保留必要护理。", structuredDecision: {
        selected_steps: [{ ownedProductId, purpose: "cleansing", why_today: "今晚需要温和完成清洁。", why_this_product: "资料确认它可用于洁面。", value_if_removed: "会失去基础清洁支持。", evidence_refs: ["source-1"] }],
        productFitAssessments: { selected: [{ ownedProductId, relevantSkinSignals: ["skin:baseline_inherited:oiliness:t_zone"], relevantWeatherSignals: ["weather:temperature", "weather:humidity", "weather:uv_index"], relevantEvidenceRefs: ["source-1"], fitSummary: "适合承担这次清洁步骤。", uncertainty: ["证据为 draft_derived，未经过独立验证。"] }] },
        candidateComparisons: [{ purpose: "cleansing", candidateIds: [ownedProductId, "10000000-0000-4000-8000-000000000002"], selectedProductIds: [ownedProductId], comparisonReason: "两款都可用于清洁，本次只保留一款以保持精简。", uncertainty: ["现有资料不足以证明明显优劣。"] }],
        unresolved_needs: [period === "pm" ? "没有可承担基础保湿收尾的产品" : "sun_protection candidate unavailable"],
      } },
      selectedSteps: [], capabilityGaps: [], dailyCareNeeds: { requiredRoles: [], optionalRoles: [], priorities: [], restrictions: [], reasons: [], unknowns: [] }, routinePolicy: { baselineRoles: [], baselineCoverage: [], residualPriorities: [], unresolvedResidualPriorities: [] }, abstentions: [], version: 1,
    },
    excluded_products: [],
    steps: [{ id: "40000000-0000-4000-8000-000000000001", owned_product_id: ownedProductId, step_order: 1, role: "cleanser", reason: "基础分 40；+10；+8", reason_code: "BASE_ROUTINE_SELECTED", score: 0, score_breakdown: { base: 0, skin_fit: 0, weather_fit: 0, feedback_score: 0, inventory_priority: 0 }, product: { id: "50000000-0000-4000-8000-000000000001", user_id: "60000000-0000-4000-8000-000000000001", brand_name: "POLA", product_name: "黑 BA 洁面奶", product_type: "cleanser", category: "skincare", created_at: "2026-09-07T00:00:00.000Z", updated_at: "2026-09-07T00:00:00.000Z" } as never }],
    routine_date: "2026-09-07", created_at: "2026-09-07T00:00:00.000Z", updated_at: "2026-09-07T00:00:00.000Z",
  } as Routine;
}
