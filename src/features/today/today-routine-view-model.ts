import type { Routine, RoutineRole } from "@/schemas/routine";
import { consumerAreaLabel, consumerConcernLabel } from "@/features/today/consumer-skin-labels";

const purposeLabels = { cleansing: "清洁", basic_moisturization: "基础保湿", hydration_support: "轻量补水", sun_protection: "防晒", optional_treatment: "针对性护理" } as const;
const roleLabels: Record<RoutineRole, string> = { remover: "卸妆", cleanser: "清洁", hydration: "轻量补水", treatment: "针对性护理", moisturizer: "基础保湿", sunscreen: "防晒" };
const restrictionContent = { REDUCE_TREATMENT: "今天减少功效型护理，让皮肤保持稳定。", LIMIT_LAYERING: "今天减少叠加使用，让护理步骤更轻松。", AVOID_HEAVY_OIL: "今天暂时避免厚重油润的护理。", PREFER_GENTLE_ROUTINE: "今天优先温和护理，减少可能带来负担的步骤。" } as const;

export type TodayExplanationStep = { id: string; order: number; productName: string; purposeLabel: string; reason: string | null; comparisonNote: string | null; usage: string | null; whyToday: string | null; whyThisProduct: string | null; howToUse: string | null };
export type TodayUnresolvedNeed = { concern: string; whatIsMissing: string; whyItMatters: string; urgency: "needed_today" | "helpful_if_needed" | "long_term_only" };
export type TodayPurposeOmission = { purposeLabel: string; message: string };
export type TodayRoutineViewModel = { headline: string; generationSource: "llm" | "deterministic_fallback" | "legacy"; todayContext: string[]; baselineContext: string[]; weatherContext: string | null; restrictions: string[]; steps: TodayExplanationStep[]; purposeOmissions: TodayPurposeOmission[]; unresolvedNeeds: TodayUnresolvedNeed[]; usesPlannerDecision: boolean };

export function buildTodayRoutineViewModel(routine: Routine | null): TodayRoutineViewModel | null {
  if (!routine) return null;
  const generationSource = routine.decision_snapshot?.planner?.generationSource ?? "legacy";
  const isDeterministicFallback = generationSource === "deterministic_fallback";
  const decision = plannerDecision(routine);
  const selected = arrayOfRecords(decision?.selected_steps);
  const selectedProductEvidence = arrayOfRecords(decision?.selectedProductEvidence);
  const assessments = arrayOfRecords(recordOf(decision?.productFitAssessments)?.selected);
  const consumerNarrativePayload = recordOf(decision?.consumerNarrative);
  const consumerNarratives = arrayOfRecords(consumerNarrativePayload?.entries);
  const usedSkinSignals = unique(assessments.flatMap((item) => stringArray(item.relevantSkinSignals)));
  const steps = routine.steps.map((step): TodayExplanationStep => {
    const plannerStep = selected.find((item) => item.ownedProductId === step.owned_product_id);
    const fit = assessments.find((item) => item.ownedProductId === step.owned_product_id);
    const purpose = stringValue(plannerStep?.purpose);
    const productEvidence = selectedProductEvidence.find((item) => item.ownedProductId === step.owned_product_id && (!purpose || item.purpose === purpose));
    const consumerNarrative = consumerNarratives.find((item) => item.ownedProductId === step.owned_product_id);
    const selectionRationale = recordOf(plannerStep?.selection_rationale);
    const persistedWhyToday = decision ? safeSavedNarrative(stringValue(plannerStep?.why_today)) : null;
    const whyToday = persistedWhyToday ?? userCenteredNeed({ savedReason: stringValue(plannerStep?.why_today) ?? savedStepReason(step.reason), purpose, skinSignals: stringArray(fit?.relevantSkinSignals), period: routine.period });
    const whyThisProduct = isDeterministicFallback
      ? null
      : safeSavedNarrative(stringValue(selectionRationale?.whySelectedToday))
        ?? userCenteredProductFit({ purpose, productEvidence, savedFit: stringValue(fit?.fitSummary), savedReason: stringValue(plannerStep?.why_this_product) });
    const howToUse = useInstruction(purpose, routine.period, selected.filter((item) => stringValue(item.purpose) === purpose).length > 1);
    return {
      id: step.id, order: step.step_order,
      productName: `${step.product.brand_name ? `${step.product.brand_name} · ` : ""}${step.product.product_name}`,
      purposeLabel: purposeLabel(purpose, step.role),
      // A generated narration is the only presentation that reconnects the
      // saved local need with this product's factual fit. Legacy snapshots
      // retain their safe, narrower product-fit fallback.
      reason: isDeterministicFallback ? null : consumerNarrativeText(consumerNarrative?.reason) ?? whyThisProduct,
      comparisonNote: isDeterministicFallback ? null : consumerNarrativeText(consumerNarrative?.comparison_note)
        ?? savedComparisonNote(selectionRationale),
      usage: consumerNarrativeText(consumerNarrative?.usage) ?? howToUse,
      whyToday,
      whyThisProduct,
      howToUse,
    };
  });
  const todayContext = usedSkinSignals.flatMap((signal) => {
    const parsed = parseSkinSignal(signal);
    return parsed && parsed.source !== "baseline_inherited" ? [`今天确认到：${parsed.label}。`] : [];
  });
  const baselineContext = usedSkinSignals.flatMap((signal) => {
    const parsed = parseSkinSignal(signal);
    return parsed?.source === "baseline_inherited" ? [`你平时${parsed.label}。`] : [];
  }).slice(0, 2);
  return {
    headline: isDeterministicFallback
      ? "本次智能方案暂未生成成功，当前展示基础护理安排。"
      : consumerNarrative(routine.decision_snapshot?.planner?.strategySummary) ?? (routine.period === "pm" ? "这是今晚已保存的护理方案。" : "这是今天早上已保存的护理方案。"),
    generationSource,
    todayContext: unique(todayContext), baselineContext: unique(baselineContext),
    weatherContext: describeWeatherContext({ snapshot: routine.weather_snapshot ?? {}, selected, assessments, consumerNarratives }),
    restrictions: routine.explanation?.restrictions.map((item) => restrictionContent[item.code]) ?? [],
    steps,
    purposeOmissions: purposeOmissions({
      decision,
      selectedPurposes: new Set(selected.map((step) => stringValue(step.purpose)).filter((purpose): purpose is string => purpose !== null)),
      narrated: arrayOfRecords(consumerNarrativePayload?.purposeOmissions),
    }),
    unresolvedNeeds: uniqueBy(stringArray(decision?.unresolved_needs)
      .flatMap((value) => userFacingUnresolvedNeed(value, routine.period)), (need) => need.concern),
    usesPlannerDecision: decision !== null,
  };
}

const visibleExclusionReasons = { AVOID_INGREDIENT_MATCH: "与你设置的避用成分存在明确匹配，今天先不要使用。", RECENT_HIGH_REACTION_HARD_BLOCK: "近期使用后记录过明显不适，今天建议先暂停。", HIGH_SENSITIVITY_REDUCE_ACTIVE: "今天的护理安排需要减少功效型步骤，建议先暂停这款产品。" } as const;
export function userFacingExcludedProducts(routine: Routine) { return routine.excluded_products.flatMap((item) => { const reason = visibleExclusionReasons[item.reason_code as keyof typeof visibleExclusionReasons]; return reason ? [{ ...item, reason }] : []; }); }

function plannerDecision(routine: Routine): Record<string, unknown> | null { if (routine.decision_snapshot?.planner?.generationSource !== "llm") return null; return recordOf(routine.decision_snapshot.planner.structuredDecision); }
function parseSkinSignal(signal: string): { source: string; label: string } | null { const match = /^skin:(today_confirmed|manual_override|baseline_inherited):([^:]+):([^:]+)$/.exec(signal); if (!match) return null; const [, source, concern, area] = match; return { source, label: `${consumerAreaLabel(area)}${consumerConcernLabel(concern)}` }; }
function describeWeatherContext(input: { snapshot: Record<string, unknown>; selected: Record<string, unknown>[]; assessments: Record<string, unknown>[]; consumerNarratives: Record<string, unknown>[] }): string | null {
  const allItems = [numericWeather(input.snapshot, ["temperature", "temperature_c"], "℃"), numericWeather(input.snapshot, ["humidity", "humidity_percent"], "%", "湿度 "), numericWeather(input.snapshot, ["uv_index"], "", "UV ")].filter((item): item is string => item !== null);
  if (!allItems.length) return null;
  const effect = weatherEffect(input);
  if (effect) return `${allItems.join(" · ")}；${effect}`;
  return `${allItems.join(" · ")}；当前保存的方案没有记录环境带来额外护理调整，主要依据今天的皮肤状态和已有产品安排。`;
}

function purposeOmissions(input: { decision: Record<string, unknown> | null; selectedPurposes: Set<string>; narrated: Record<string, unknown>[] }): TodayPurposeOmission[] {
  const labels: Record<string, string> = {
    cleansing: "清洁",
    basic_moisturization: "基础保湿",
    hydration_support: "补水",
    sun_protection: "防晒",
    optional_treatment: "针对性护理",
  };
  const messages: Record<string, string> = {
    not_needed_today: "今天没有额外加入这一步，当前方案已经覆盖主要护理方向。",
    deferred_by_step_limit: "今天先保持精简，不额外叠加这一步。",
    no_eligible_evidence: "现有产品里暂时没有足够可靠的信息支持这一步。",
    hard_restricted: "今天这类护理先暂停。",
  };
  return uniqueBy(arrayOfRecords(input.decision?.purposeOmissions).flatMap((omission) => {
    const purpose = stringValue(omission.purpose);
    const reason = stringValue(omission.reason);
    if (!purpose || !reason || !labels[purpose] || !messages[reason] || input.selectedPurposes.has(purpose)) return [];
    const narrated = input.narrated.find((item) => item.purpose === purpose && item.reason === reason);
    return [{
      purposeLabel: labels[purpose],
      message: consumerNarrativeText(narrated?.message) ?? messages[reason],
    }];
  }), (item) => item.purposeLabel);
}
function weatherEffect(input: { selected: Record<string, unknown>[]; assessments: Record<string, unknown>[]; consumerNarratives: Record<string, unknown>[] }) {
  const narratedEffect = input.assessments.flatMap((fit) => {
    if (!stringArray(fit.relevantWeatherSignals).length) return [];
    const narrative = input.consumerNarratives.find((item) => item.ownedProductId === fit.ownedProductId);
    return weatherSpecificSentence(consumerNarrativeText(narrative?.reason));
  }).find((value): value is string => value !== undefined);
  if (narratedEffect) return `今天的环境对方案有实际影响：${narratedEffect}`;
  const selectedEffect = input.selected.flatMap((step) => {
    const fit = input.assessments.find((item) => item.ownedProductId === step.ownedProductId);
    if (!stringArray(fit?.relevantWeatherSignals).length) return [];
    // why_this_product is product selection rationale, never Weather-card copy.
    return weatherSpecificSentence(safeSavedNarrative(stringValue(step.why_today)));
  }).find((value): value is string => value !== null);
  if (selectedEffect) return `今天的环境对方案有实际影响：${selectedEffect}`;
  return input.assessments.some((fit) => stringArray(fit.relevantWeatherSignals).length)
    ? "今天的环境已纳入方案，但没有带来明显额外调整。"
    : null;
}
const weatherFactLanguage = /(?:紫外|\bUV\b|天气|温度|湿度|环境|\d+(?:\.\d+)?\s*℃)/iu;
const weatherAdjustmentLanguage = /(?:因此|所以|保持|减少|加强|优先|避免|防晒|轻薄|精简|最后一步|不额外)/u;
const productExplanationLanguage = /(?:成分|配方|质地|泡沫|肤感|产品|洁面|精华|面霜|喷雾|使用|涂抹|取适量|比较|另一瓶|候选)/u;
function weatherSpecificSentence(value: string | null): string | null {
  if (!value) return null;
  const sentences = value.match(/[^。！？；]+[。！？；]?/gu) ?? [];
  const sentence = sentences.find((item) => weatherFactLanguage.test(item)
    && weatherAdjustmentLanguage.test(item)
    && !productExplanationLanguage.test(item));
  return sentence ? consumerNarrative(sentence.trim()) : null;
}
function numericWeather(snapshot: Record<string, unknown>, keys: string[], suffix: string, prefix = "温度 ") { for (const key of keys) { const value = snapshot[key]; if (typeof value === "number") return `${prefix}${value}${suffix}`; } return null; }
function userCenteredNeed(input: { savedReason: string | null; purpose: string | null; skinSignals: string[]; period: Routine["period"] }) {
  const skin = input.skinSignals.map(parseSkinSignal).filter((item): item is NonNullable<typeof item> => item !== null);
  const context = [...skin.filter((item) => item.source !== "baseline_inherited"), ...skin.filter((item) => item.source === "baseline_inherited")].map((item) => item.label).slice(0, 2).join("、");
  if (input.purpose === "cleansing") return context ? `今天会兼顾${context}，因此保留基础清洁，不额外加强清洁负担。` : input.period === "am" ? "早上先完成基础清洁，让后续护理保持简单。" : "今晚先完成基础清洁，为后续护理留出轻松的基础。";
  if (input.purpose === "hydration_support") return context ? `今天会兼顾${context}，因此加入轻量补水，不需要叠加过多步骤。` : "今天加入一层轻量补水，让护理保持简单舒适。";
  if (input.purpose === "basic_moisturization") return context ? `今天会兼顾${context}，因此用这一步完成保湿收尾。` : "这一步帮助完成今天的基础保湿收尾。";
  if (input.purpose === "sun_protection") return "白天需要把防晒作为护肤最后一步，帮助应对今天的日间环境。";
  if (input.purpose === "optional_treatment") return context ? `今天主要关注${context}，因此只加入这一项针对性护理。` : "今天只保留这一项有明确用途的针对性护理。";
  return safeSavedNarrative(input.savedReason);
}
function userCenteredProductFit(input: { purpose: string | null; productEvidence: Record<string, unknown> | undefined; savedFit: string | null; savedReason: string | null }) {
  const facts = relevantProductFacts(input.productEvidence, input.purpose);
  if (facts.length) return `这瓶产品${facts.join("，")}，因此适合承担今天这一步。`;
  // Saved free text may be useful to an audit, but it can contain a knowledge
  // provenance discussion. The consumer surface only falls back to it when it
  // survives the narrow, non-technical projection below.
  return safeSavedNarrative(input.savedReason) ?? safeSavedNarrative(input.savedFit) ?? "它符合本次已保存的护理安排。";
}
function relevantProductFacts(value: Record<string, unknown> | undefined, purpose: string | null) {
  if (!value) return [];
  const claims = stringArray(value.relevantClaims);
  const texture = stringArray(value.relevantTextureFacts);
  const usage = stringArray(value.relevantUsageFacts);
  const claimKeywords = purpose === "cleansing" ? /清洁|洁净|控油|平衡|不紧绷/iu : purpose === "sun_protection" ? /防晒|uv|紫外/iu : purpose === "optional_treatment" ? /痘|毛孔|平滑|调理|舒缓|修护/iu : /补水|保湿|水分|舒缓|平衡油脂/iu;
  const selectedClaims = claims.filter((claim) => claimKeywords.test(claim)).slice(0, 2);
  const result = selectedClaims.length ? [`有${selectedClaims.join("、")}相关信息`] : [];
  const ingredients = stringArray(value.relevantConsumerIngredients).slice(0, 2);
  if (ingredients.length) result.push(`配方资料中包含${ingredients.join("、")}`);
  if (texture[0]) result.push(`质地${texture[0]}`);
  if (!result.length && usage[0]) result.push(`使用方式为${usage[0]}`);
  return result.slice(0, 3);
}
function useInstruction(purpose: string | null, period: Routine["period"], hasCompanionStep: boolean) {
  if (purpose === "cleansing") return "按产品说明取适量清洁即可；洗后不需要反复清洁。";
  if (purpose === "hydration_support") return hasCompanionStep ? "按这次方案的步骤顺序薄薄使用即可，不需要额外增加其他产品。" : "洁面后薄薄一层即可；不需要和另一款补水产品固定叠加。";
  if (purpose === "basic_moisturization") return "在补水步骤后用作保湿收尾，按产品说明适量涂开即可。";
  if (purpose === "sun_protection") return "早上护肤的最后一步使用；外出前按产品说明足量涂匀。";
  if (purpose === "optional_treatment") return period === "pm" ? "按产品说明使用即可；今晚不需要再叠加其他功效型产品。" : "按产品说明使用即可；不需要叠加其他功效型产品。";
  return null;
}
function userFacingUnresolvedNeed(value: string, period: Routine["period"]): TodayUnresolvedNeed[] {
  const normalized = value.toLowerCase();
  if (/防晒|sun[_\s-]?protection|sunscreen/.test(normalized)) return period === "am" ? [{ concern: "防晒", whatIsMissing: "现有产品里暂时没有合适的防晒步骤", whyItMatters: "日间环境下，这部分基础保护目前没有被现有产品覆盖。", urgency: "needed_today" }] : [];
  if (/基础保湿|basic[_\s-]?moisturization|锁水|封层|保湿收尾/.test(normalized)) return [{ concern: "基础保湿", whatIsMissing: "现有产品里暂时没有合适的基础保湿收尾", whyItMatters: "如果晚间洗后仍觉得干，这部分需求暂时没有特别合适的现有产品承接。", urgency: "helpful_if_needed" }];
  if (/补水|hydration[_\s-]?support/.test(normalized)) return [{ concern: "补水", whatIsMissing: "现有产品里暂时没有合适的轻量补水步骤", whyItMatters: "如果洗后感觉紧绷或局部发干，这部分需求暂时没有特别合适的现有产品承接。", urgency: "helpful_if_needed" }];
  return [];
}
function savedComparisonNote(rationale: Record<string, unknown> | null) {
  if (!rationale || stringValue(rationale.comparisonMode) === null) return null;
  const whySelectedToday = safeSavedNarrative(stringValue(rationale.whySelectedToday));
  const differences = stringArray(rationale.relevantDifferences)
    .map((difference) => safeSavedNarrative(difference))
    .filter((difference): difference is string => difference !== null);
  if (!whySelectedToday || differences.length === 0) return null;
  return `${whySelectedToday} ${differences[0]}`;
}
function purposeLabel(purpose: string | null, role: RoutineRole) { return purpose && purpose in purposeLabels ? purposeLabels[purpose as keyof typeof purposeLabels] : roleLabels[role]; }
function consumerNarrativeText(value: unknown) {
  const text = stringValue(value);
  if (!text || technicalNarrativePattern.test(text)) return null;
  return consumerNarrative(text);
}
const technicalNarrativePattern = /(?:source|evidence|confidence|draft|verified|advisory|unknown|runtime|validator|supportedPurpose|候选|其他产品也可以|来源支持|产品证据|可用证据|资料不足|证据不足|数据不足)/iu;
function safeSavedNarrative(value: string | null | undefined) { return value && !technicalNarrativePattern.test(value) ? consumerNarrative(value) : null; }
function consumerNarrative(value: string | null | undefined): string | null {
  if (!value) return null;
  const projected = value
    .replace(/basic_moisturization/giu, "基础保湿").replace(/hydration_support/giu, "轻量补水").replace(/sun_protection/giu, "防晒").replace(/optional_treatment/giu, "针对性护理").replace(/cleansing/giu, "清洁")
    .replace(/\b(?:draft_derived|verified|supportedPurposes|eligibleProducts?|evidence(?:\s+ref)?|confidence|validator|provider|projection|runtime)\b/giu, "")
    .replace(/(?:来源支持|产品证据|可用证据|产品信息|资料不足|证据不足|数据不足|不确定|无法证明明显优劣|head-to-head|未经过独立验证|仍待进一步核验)[。；，,]?/giu, "")
    .replace(/\s{2,}/g, " ").trim();
  return projected || null;
}
function savedStepReason(reason: string) { return /基础分|\+\d+|score|reason_code/iu.test(reason) ? null : reason; }
function recordOf(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function arrayOfRecords(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(recordOf).filter((item): item is Record<string, unknown> => item !== null) : []; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function unique<T>(values: T[]) { return [...new Set(values)]; }
function uniqueBy<T>(values: T[], key: (value: T) => string) { return [...new Map(values.map((value) => [key(value), value])).values()]; }
