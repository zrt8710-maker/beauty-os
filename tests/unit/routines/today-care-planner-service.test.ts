import { describe, expect, it } from "vitest";

import { carePlannerDecisionSchema, type CarePlannerInput, validateCarePlannerDecisionDetailed } from "@/server/services/today-care-planner-service";
import type { PlannerProductFactField } from "@/server/services/planner-product-evidence-service";

const evidence = (purposes: Array<"cleansing" | "basic_moisturization" | "hydration_support" | "optional_treatment" | "sun_protection">, usage: string[] = []) => ({
  productType: "toner" as const, claims: [{ text: "补水保湿", evidenceRefs: ["src-1"] }], usage: usage.length > 0 ? { instructions: usage, cautions: [], evidenceRefs: ["src-1"] } : null, texture: null,
  ingredients: [], advisoryIngredients: [], sourceRefs: [{ id: "src-1", sourceType: "official_brand", title: "产品页" }], supportedPurposes: purposes, evidenceRefs: ["src-1"], usableSkincareEvidence: true, provenance: "draft_derived" as const,
  knownFacts: ["productType", "claims"] as PlannerProductFactField[], unknownFields: ["texture", "usage", "cautions", "ingredients"] as PlannerProductFactField[], limitations: ["texture_unknown", "usage_unknown", "cautions_unknown", "ingredients_unknown"],
});
const candidates: CarePlannerInput["eligibleProducts"] = [
  { ownedProductId: "50000000-0000-4000-8000-000000000001", displayName: "洁面", productType: "cleanser", productEvidence: evidence(["cleansing"]), knownFacts: ["productType", "claims"], unknownFields: ["texture", "usage", "cautions", "ingredients"], limitations: ["texture_unknown", "usage_unknown", "cautions_unknown", "ingredients_unknown"], supportedPurposes: ["cleansing"], inventory: { quantityPercent: 70 }, usageHistory: { usageCount: 0, averageRating: null, positiveSignals: [], preferenceIssues: [], highReactionCount: 0, recentRelevantFeedbackSummary: null } },
  { ownedProductId: "50000000-0000-4000-8000-000000000002", displayName: "保湿喷雾", productType: "toner", productEvidence: evidence(["basic_moisturization", "hydration_support"]), knownFacts: ["productType", "claims"], unknownFields: ["texture", "usage", "cautions", "ingredients"], limitations: ["texture_unknown", "usage_unknown", "cautions_unknown", "ingredients_unknown"], supportedPurposes: ["basic_moisturization", "hydration_support"], inventory: { quantityPercent: 80 }, usageHistory: { usageCount: 0, averageRating: null, positiveSignals: [], preferenceIssues: [], highReactionCount: 0, recentRelevantFeedbackSummary: null } },
];
const decision = {
  strategy: "barrier_focused" as const, strategy_summary: "今天以基础保湿为主。", unresolved_needs: [], usedGuidanceIds: ["GUIDE-MOISTURE-01"],
  productFitAssessments: {
    selected: candidates.map((candidate, index) => ({
      ownedProductId: candidate.ownedProductId,
      relevantSkinSignals: ["skin-1"],
      relevantWeatherSignals: [],
      supportedPurposes: candidate.supportedPurposes,
      positiveFitReasons: [index === 0 ? "具备清洁用途证据。" : "具备与当前干燥背景相关的补水用途证据。"],
      negativeFitReasons: [],
      uncertainty: [],
      relevantEvidenceRefs: ["src-1"],
      fitSummary: index === 0 ? "可承担清洁。" : "可承担保湿相关用途。",
      fitLevel: "reasonable" as const,
    })),
    topAlternatives: [],
  },
  selected_steps: [
    { ownedProductId: candidates[0].ownedProductId, purpose: "cleansing" as const, why_today: "完成晚间基础护理", why_this_product: "输入证据确认其为洁面产品。", evidence_refs: ["src-1"] },
    { ownedProductId: candidates[1].ownedProductId, purpose: "basic_moisturization" as const, why_today: "鼻翼较干并起皮。", why_this_product: "输入证据确认补水保湿用途。", evidence_refs: ["src-1"] },
  ],
};

describe("Today Care Planner purpose validator", () => {
  const input = { candidates, careGuidanceIds: ["GUIDE-MOISTURE-01"], hardRestrictions: [], maxSteps: 3, skinSignals: [{ signalId: "skin-1", concern: "dryness", area: "nose_wings", status: "present", grade: 2, source: "today_confirmed" as const, comparison: "more_than_usual" }] };
  const decisionWithComparison = {
    ...decision,
    selected_steps: [{
      ...decision.selected_steps[0],
      selection_rationale: {
        candidateIds: [candidates[0].ownedProductId, candidates[1].ownedProductId],
        selectedProductId: candidates[0].ownedProductId,
        relevantDifferences: ["真实候选的差异"],
        whySelectedToday: "今天优先选择这一瓶。",
        certainty: "uncertain" as const,
      },
    }, decision.selected_steps[1]],
    candidateComparisons: [{
      purpose: "cleansing" as const,
      candidateIds: [candidates[0].ownedProductId, candidates[1].ownedProductId],
      selectedProductIds: [candidates[0].ownedProductId],
      selectionMode: "single" as const,
      comparisonReason: "两件真实候选都被引用。",
      multipleSelectionReason: null,
      uncertainty: ["用途不同。"],
    }],
  };

  it("accepts complete owned-product UUIDs and rejects truncated IDs or product names before validation", () => {
    expect(carePlannerDecisionSchema.safeParse(decisionWithComparison).success).toBe(true);

    for (const invalidId of ["50000000-0000-4000", "POLA 黑BA洗面奶"]) {
      const parsed = carePlannerDecisionSchema.safeParse({
        ...decisionWithComparison,
        candidateComparisons: [{ ...decisionWithComparison.candidateComparisons[0], candidateIds: [candidates[0].ownedProductId, invalidId] }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("does not convert a UUID catalog-like ID that is not an eligible owned product", () => {
    const catalogLikeId = "50000000-0000-4000-8000-000000000099";
    const schemaParsed = carePlannerDecisionSchema.safeParse({
      ...decisionWithComparison,
      selected_steps: [{ ...decisionWithComparison.selected_steps[0], ownedProductId: catalogLikeId }, decisionWithComparison.selected_steps[1]],
    });
    expect(schemaParsed.success).toBe(true);
    if (!schemaParsed.success) return;

    const result = validateCarePlannerDecisionDetailed({ ...input, decision: schemaParsed.data });
    expect(result).toMatchObject({ valid: false, reason: "STEP_CONTRACT_INVALID" });
  });

  it("accepts Tier-B evidence for a purpose different from the formal role", () => {
    const result = validateCarePlannerDecisionDetailed({ ...input, decision });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.selectedSteps[1]).toEqual({ ownedProductId: candidates[1].ownedProductId, purpose: "basic_moisturization" });
  });

  it("validates an explicit scoped preference reference without deciding the soft preference", () => {
    const preference = { scope: "routine_role" as const, period: "am" as const, routine_role: "cleanser" as const, polarity: "avoid" as const, preferenceRef: "routine_role:am:cleanser" };
    const missingReference = validateCarePlannerDecisionDetailed({
      ...input, period: "am", routineRolePreferences: [preference], decision,
    });
    expect(missingReference).toMatchObject({ valid: false, reason: "EXPLICIT_PREFERENCE_REFERENCE_MISSING" });

    const referenced = validateCarePlannerDecisionDetailed({
      ...input,
      period: "am",
      routineRolePreferences: [preference],
      decision: { ...decision, selected_steps: [{ ...decision.selected_steps[0], preference_refs: [preference.preferenceRef] }, decision.selected_steps[1]] },
    });
    expect(referenced.valid).toBe(true);
    if (referenced.valid) expect(referenced.decision.selected_steps[0]?.preference_refs).toEqual([preference.preferenceRef]);
  });

  it.each([
    ["cleanser", "cleansing", "cleansing"],
    ["moisturizer", "basic_moisturization", "basic_moisturization"],
  ] as const)("accepts a type-backed baseline %s without upgrading it to product evidence", (productType, purpose, baselinePurpose) => {
    const lowKnowledgeCandidate: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[0],
      productType,
      productEvidence: {
        ...candidates[0].productEvidence,
        productType: null,
        claims: [],
        usage: null,
        texture: null,
        ingredients: [],
        advisoryIngredients: [],
        sourceRefs: [],
        supportedPurposes: [],
        evidenceRefs: [],
        usableSkincareEvidence: false,
        provenance: "unknown",
        knownFacts: [],
        unknownFields: ["productType", "claims", "texture", "usage", "cautions", "ingredients"],
        limitations: ["productType_unknown", "claims_unknown", "texture_unknown", "usage_unknown", "cautions_unknown", "ingredients_unknown"],
      },
      knownFacts: [],
      unknownFields: ["productType", "claims", "texture", "usage", "cautions", "ingredients"],
      limitations: ["productType_unknown", "claims_unknown", "texture_unknown", "usage_unknown", "cautions_unknown", "ingredients_unknown"],
      supportedPurposes: [],
      baselineTypeBackedPurposes: [baselinePurpose],
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [lowKnowledgeCandidate],
      decision: {
        ...decision,
        selected_steps: [{
          ...decision.selected_steps[0],
          purpose,
          why_this_product: "这瓶是已有的基础产品。",
          evidence_refs: [],
          selection_rationale: undefined,
        }],
        productFitAssessments: {
          selected: [{
            ...decision.productFitAssessments.selected[0],
            supportedPurposes: [],
            relevantEvidenceRefs: [],
            positiveFitReasons: [],
          }],
          topAlternatives: [],
        },
      },
    });
    expect(result).toMatchObject({ valid: true });
    if (result.valid) {
      expect(result.decision.selected_steps[0].evidence_refs).toEqual([]);
      expect(result.decision.selected_steps[0].selection_rationale).toBeUndefined();
    }
  });

  it("does not let a baseline type-backed purpose become a sunscreen, serum, or toner capability", () => {
    const lowKnowledge = {
      ...candidates[0],
      supportedPurposes: [],
      baselineTypeBackedPurposes: [],
    };
    for (const [productType, purpose] of [
      ["sunscreen", "sun_protection"],
      ["serum", "optional_treatment"],
      ["toner", "hydration_support"],
    ] as const) {
      const result = validateCarePlannerDecisionDetailed({
        ...input,
        candidates: [{ ...lowKnowledge, productType }],
        decision: {
          ...decision,
          selected_steps: [{ ...decision.selected_steps[0], purpose, evidence_refs: [] }],
          productFitAssessments: { selected: [{ ...decision.productFitAssessments.selected[0], supportedPurposes: [], relevantEvidenceRefs: [] }], topAlternatives: [] },
        },
      });
      expect(result.valid).toBe(false);
    }
  });

  it("reorders any product with an explicit last-skincare-step instruction after leave-on steps", () => {
    const genericFilmFormingTreatment: CarePlannerInput["eligibleProducts"][number] = {
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "通用成膜局部护理",
      productType: "serum" as const,
      productEvidence: evidence(["optional_treatment"], ["因为会成膜，一般使用在护肤最后一步"]),
      knownFacts: ["productType", "claims", "usage"] as PlannerProductFactField[],
      unknownFields: ["texture", "cautions", "ingredients"] as PlannerProductFactField[],
      limitations: ["texture_unknown", "cautions_unknown", "ingredients_unknown"],
      supportedPurposes: ["optional_treatment"],
      inventory: { quantityPercent: 80 },
      usageHistory: { usageCount: 0, averageRating: null, positiveSignals: [], preferenceIssues: [], highReactionCount: 0, recentRelevantFeedbackSummary: null },
    };
    const orderingCandidates = [...candidates, genericFilmFormingTreatment];
    const orderingDecision = {
      ...decision,
      selected_steps: [
        decision.selected_steps[0],
        {
          ownedProductId: genericFilmFormingTreatment.ownedProductId,
          purpose: "optional_treatment" as const,
          why_today: "今天需要局部护理。",
          why_this_product: "有成膜型局部护理的使用依据。",
          evidence_refs: ["src-1"],
        },
        decision.selected_steps[1],
      ],
      productFitAssessments: {
        ...decision.productFitAssessments,
        selected: [
          ...decision.productFitAssessments.selected,
          {
            ownedProductId: genericFilmFormingTreatment.ownedProductId,
            relevantSkinSignals: ["skin-1"],
            relevantWeatherSignals: [],
            supportedPurposes: ["optional_treatment" as const],
            positiveFitReasons: ["有来源支持的局部护理使用信息。"],
            negativeFitReasons: [],
            uncertainty: [],
            relevantEvidenceRefs: ["src-1"],
            fitSummary: "可作为今天的局部护理。",
            fitLevel: "reasonable" as const,
          },
        ],
      },
    };

    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: orderingCandidates,
      decision: orderingDecision,
      maxSteps: 4,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.selected_steps.map((step) => step.ownedProductId)).toEqual([
        candidates[0].ownedProductId,
        candidates[1].ownedProductId,
        genericFilmFormingTreatment.ownedProductId,
      ]);
      expect(result.warnings).toContainEqual({
        code: "USAGE_ORDER_REORDERED",
        ids: [genericFilmFormingTreatment.ownedProductId],
      });
    }
  });

  it("keeps a selected step's AI selection rationale when it names real competing candidates", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      decision: {
        ...decision,
        selected_steps: decision.selected_steps.map((step) => ({
          ...step,
          selection_rationale: {
            candidateIds: [step.ownedProductId],
            selectedProductId: step.ownedProductId,
            relevantDifferences: ["与今天状态相关的产品信息"],
            whySelectedToday: "今天更倾向这瓶来完成当前步骤。",
            certainty: "uncertain" as const,
          },
        })),
      },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.selected_steps[0]?.selection_rationale).toMatchObject({
        selectedProductId: candidates[0].ownedProductId,
        candidateIds: [candidates[0].ownedProductId],
      });
    }
  });

  it("does not compare POLA with a cleanser that only has a type-backed baseline fallback", () => {
    const fuqing: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[0],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "芙清洁面",
      productEvidence: {
        ...candidates[0].productEvidence,
        productType: null,
        claims: [],
        usage: null,
        texture: null,
        ingredients: [],
        advisoryIngredients: [],
        sourceRefs: [],
        supportedPurposes: [],
        evidenceRefs: [],
        usableSkincareEvidence: false,
        provenance: "unknown" as const,
        knownFacts: [],
        unknownFields: ["productType", "claims", "texture", "usage", "cautions", "ingredients"] as PlannerProductFactField[],
        limitations: ["productType_unknown", "claims_unknown", "texture_unknown", "usage_unknown", "cautions_unknown", "ingredients_unknown"],
      },
      supportedPurposes: [],
      baselineTypeBackedPurposes: ["cleansing" as const],
    };
    const rationale = {
      candidateIds: [candidates[0].ownedProductId, fuqing.ownedProductId],
      selectedProductId: candidates[0].ownedProductId,
      relevantDifferences: ["芙清没有可用于比较的产品资料。"],
      whySelectedToday: "POLA 有明确的洁面资料。",
      certainty: "uncertain" as const,
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [...candidates, fuqing],
      decision: {
        ...decision,
        selected_steps: [{ ...decision.selected_steps[0], selection_rationale: rationale }, decision.selected_steps[1]],
        candidateComparisons: [{
          purpose: "cleansing",
          candidateIds: rationale.candidateIds,
          selectedProductIds: [candidates[0].ownedProductId],
          selectionMode: "single",
          comparisonReason: "两款都可用于洁面。",
          multipleSelectionReason: null,
          uncertainty: ["芙清资料不足。"],
        }],
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.decision.candidateComparisons).toEqual([]);
    expect(result.decision.selected_steps[0]?.selection_rationale).toMatchObject({
      candidateIds: [candidates[0].ownedProductId],
      whySelectedToday: "POLA 有明确的洁面资料。",
    });
  });

  it("keeps a confirmed cleanser with source-backed cleansing usage as a lightweight comparison-only alternative", () => {
    const zhiben: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[0],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "至本舒颜修护洁面乳",
      productType: "cleanser",
      productEvidence: {
        ...evidence([]),
        // The confirmed catalog identity supplies the cleanser type. Product
        // evidence may still have no independent productType field.
        productType: null,
        claims: [],
        usage: { instructions: ["用于日常面部清洁。"], cautions: [], evidenceRefs: ["src-1"] },
        supportedPurposes: [],
        knownFacts: ["productType", "usage"],
      },
      supportedPurposes: [],
      baselineTypeBackedPurposes: ["cleansing"],
    };
    const rationale = {
      candidateIds: [candidates[0].ownedProductId, zhiben.ownedProductId],
      selectedProductId: candidates[0].ownedProductId,
      relevantDifferences: ["POLA 有泡沫与洗后水润感信息，至本的资料更偏向日常面部清洁。"],
      whySelectedToday: "今天更偏向已有明确使用经验的 POLA。",
      certainty: "clear" as const,
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [...candidates, zhiben],
      decision: {
        ...decision,
        selected_steps: [{ ...decision.selected_steps[0], selection_rationale: rationale }, decision.selected_steps[1]],
        candidateComparisons: [{
          purpose: "cleansing",
          candidateIds: rationale.candidateIds,
          selectedProductIds: [candidates[0].ownedProductId],
          selectionMode: "single",
          comparisonReason: "至本的资料更偏向日常清洁；今天根据泡沫、洗后水润感和使用经验更偏向 POLA。",
          multipleSelectionReason: null,
          uncertainty: ["至本没有明确的强同角色能力资料。"],
        }],
      },
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.decision.selected_steps[0]?.ownedProductId).toBe(candidates[0].ownedProductId);
    expect(result.decision.selected_steps[0]?.selection_rationale).toMatchObject({
      candidateIds: [candidates[0].ownedProductId, zhiben.ownedProductId],
      comparisonMode: "lightweight_contextual",
    });
    expect(result.decision.candidateComparisons?.[0]).toMatchObject({
      candidateIds: [candidates[0].ownedProductId, zhiben.ownedProductId],
      comparisonMode: "lightweight_contextual",
      comparisonReason: "至本的资料更偏向日常清洁；今天根据泡沫、洗后水润感和使用经验更偏向 POLA。",
    });
    expect(zhiben.supportedPurposes).toEqual([]);
  });

  it("does not admit a depleted cleanser as a comparison-only alternative", () => {
    const depleted: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[0],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      productEvidence: { ...candidates[0].productEvidence, productType: "cleanser", supportedPurposes: [] },
      supportedPurposes: [],
      baselineTypeBackedPurposes: ["cleansing" as const],
      inventory: { quantityPercent: 0 },
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [...candidates, depleted],
      decision: {
        ...decision,
        selected_steps: [{ ...decision.selected_steps[0], selection_rationale: {
          candidateIds: [candidates[0].ownedProductId, depleted.ownedProductId],
          selectedProductId: candidates[0].ownedProductId,
          relevantDifferences: ["库存状态不同。"],
          whySelectedToday: "今天选择有库存的产品。",
          certainty: "clear",
        } }, decision.selected_steps[1]],
      },
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.decision.selected_steps[0]?.selection_rationale?.candidateIds).toEqual([candidates[0].ownedProductId]);
  });

  it("keeps a lightweight contextual comparison for source-backed hydration candidates", () => {
    const simcare: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[1],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "溪木源精华水",
      supportedPurposes: [],
      productEvidence: { ...candidates[1].productEvidence, supportedPurposes: [] },
    };
    const yilian: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[1],
      ownedProductId: "50000000-0000-4000-8000-000000000004",
      displayName: "颐莲喷雾",
      supportedPurposes: ["hydration_support" as const],
      productEvidence: { ...candidates[1].productEvidence, supportedPurposes: ["hydration_support" as const] },
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [candidates[0], simcare, yilian],
      decision: {
        ...decision,
        selected_steps: [decision.selected_steps[0], {
          ...decision.selected_steps[1],
          ownedProductId: simcare.ownedProductId,
          purpose: "hydration_support",
          selection_rationale: {
            candidateIds: [simcare.ownedProductId, yilian.ownedProductId],
            selectedProductId: simcare.ownedProductId,
            relevantDifferences: ["两者剂型与使用场景不同。"],
            whySelectedToday: "今天更偏向溪木源的清透打底感。",
            certainty: "uncertain",
          },
        }],
        productFitAssessments: { ...decision.productFitAssessments, selected: [decision.productFitAssessments.selected[0], { ...decision.productFitAssessments.selected[1], ownedProductId: simcare.ownedProductId, supportedPurposes: [] }] },
        candidateComparisons: [{
          purpose: "hydration_support",
          candidateIds: [simcare.ownedProductId, yilian.ownedProductId],
          selectedProductIds: [simcare.ownedProductId],
          selectionMode: "single",
          comparisonReason: "溪木源更适合今天。",
          multipleSelectionReason: null,
          uncertainty: ["没有头对头对比。"],
        }],
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.decision.candidateComparisons).toHaveLength(1);
    expect(result.decision.candidateComparisons?.[0]).toMatchObject({
      candidateIds: [simcare.ownedProductId, yilian.ownedProductId],
      comparisonMode: "lightweight_contextual",
      comparisonReason: "今天更偏向溪木源。",
    });
    expect(result.decision.selected_steps[1]?.selection_rationale?.candidateIds).toEqual([simcare.ownedProductId, yilian.ownedProductId]);
  });

  it("allows a restrained contextual note for a moisturizer and an evidence-backed serum without calling them the same role", () => {
    const simcareLotion: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[1],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "溪木源精华乳",
      productType: "moisturizer" as const,
      supportedPurposes: ["basic_moisturization" as const],
      productEvidence: { ...candidates[1].productEvidence, productType: "moisturizer", supportedPurposes: ["basic_moisturization" as const] },
    };
    const anxiuze: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[1],
      ownedProductId: "50000000-0000-4000-8000-000000000004",
      displayName: "安修泽精华",
      productType: "serum" as const,
      supportedPurposes: [],
      productEvidence: { ...candidates[1].productEvidence, productType: "serum", supportedPurposes: [] },
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [candidates[0], simcareLotion, anxiuze],
      decision: {
        ...decision,
        selected_steps: [decision.selected_steps[0], {
          ...decision.selected_steps[1],
          ownedProductId: simcareLotion.ownedProductId,
          purpose: "basic_moisturization",
          selection_rationale: {
            candidateIds: [simcareLotion.ownedProductId, anxiuze.ownedProductId],
            selectedProductId: simcareLotion.ownedProductId,
            relevantDifferences: ["溪木源有明确的基础保湿用途。"],
            whySelectedToday: "今天需要明确的基础保湿收尾。",
            certainty: "uncertain",
          },
        }],
        productFitAssessments: { ...decision.productFitAssessments, selected: [decision.productFitAssessments.selected[0], { ...decision.productFitAssessments.selected[1], ownedProductId: simcareLotion.ownedProductId, supportedPurposes: ["basic_moisturization"] }] },
        candidateComparisons: [{
          purpose: "basic_moisturization",
          candidateIds: [simcareLotion.ownedProductId, anxiuze.ownedProductId],
          selectedProductIds: [simcareLotion.ownedProductId],
          selectionMode: "single",
          comparisonReason: "溪木源更适合今天。",
          multipleSelectionReason: null,
          uncertainty: ["两者没有头对头比较。"],
        }],
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.decision.candidateComparisons).toHaveLength(1);
    expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: "CANDIDATE_COMPARISON_MISSING" }));
    expect(result.decision.selected_steps[1]?.selection_rationale?.candidateIds).toEqual([simcareLotion.ownedProductId, anxiuze.ownedProductId]);
  });

  it("drops only a malformed selection rationale instead of replacing a valid plan", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      decision: {
        ...decision,
        selected_steps: [{
          ...decision.selected_steps[0],
          selection_rationale: {
            candidateIds: [candidates[0].ownedProductId],
            selectedProductId: candidates[1].ownedProductId,
            relevantDifferences: [],
            whySelectedToday: "错误引用。",
            certainty: "uncertain",
          },
        }, decision.selected_steps[1]],
      },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.selected_steps[0]?.selection_rationale).toBeUndefined();
      expect(result.warnings).toContainEqual({ code: "SELECTION_RATIONALE_DROPPED", ids: [candidates[0].ownedProductId] });
    }
  });
  it("drops an advisory guidance citation without discarding an otherwise valid proposal", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      decision: { ...decision, usedGuidanceIds: ["GUIDE-MOISTURE-01", "GUIDE-OIL-01"] },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.status).toBe("valid_with_warnings");
      expect(result.decision.usedGuidanceIds).toEqual(["GUIDE-MOISTURE-01"]);
      expect(result.droppedGuidanceIds).toEqual(["GUIDE-OIL-01"]);
      expect(result.warnings).toContainEqual({ code: "GUIDANCE_REFERENCE_DROPPED", ids: ["GUIDE-OIL-01"] });
    }
  });
  it("allows an unresolved baseline purpose when no eligible product has evidence to perform it", () => {
    const noBaselineCandidate = candidates.map((candidate, index) => index === 1
      ? {
          ...candidate,
          supportedPurposes: ["hydration_support"] as CarePlannerInput["eligibleProducts"][number]["supportedPurposes"],
        }
      : candidate,
    );
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: noBaselineCandidate,
      decision: {
        ...decision,
        productFitAssessments: {
          ...decision.productFitAssessments,
          selected: [decision.productFitAssessments.selected[0]],
        },
        selected_steps: [decision.selected_steps[0]],
        unresolved_needs: ["基础保湿暂未找到足够可信的可用产品。"],
      },
    });
    expect(result.valid).toBe(true);
  });
  it("allows a low-risk moisturization intent when a product has real source-backed facts", () => {
    const hydrationOnlyCandidates: CarePlannerInput["eligibleProducts"] = candidates.map((candidate, index) => index === 1
      ? {
          ...candidate,
          // The claim still says 补水保湿. Validator must use this purpose
          // list rather than reinterpreting the claim text.
          supportedPurposes: ["hydration_support"],
        }
      : candidate,
    );
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: hydrationOnlyCandidates,
      decision: {
        ...decision,
        productFitAssessments: {
          ...decision.productFitAssessments,
          selected: decision.productFitAssessments.selected.map((assessment, index) => index === 1
            ? { ...assessment, supportedPurposes: ["hydration_support"] as const }
            : assessment),
        },
      },
    });
    expect(result).toMatchObject({ valid: true });
  });
  it("accepts basic moisturization from a hydration-role product only when its purpose evidence says so", () => {
    const result = validateCarePlannerDecisionDetailed({ ...input, decision });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.selectedSteps).toContainEqual({
      ownedProductId: candidates[1].ownedProductId,
      purpose: "basic_moisturization",
    });
  });
  it("allows contextual AM cleansing and hydration without a sunscreen candidate", () => {
    const amDecision = {
      ...decision,
      selected_steps: [
        decision.selected_steps[0],
        { ...decision.selected_steps[1], purpose: "hydration_support" as const },
      ],
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      decision: amDecision,
    });
    expect(result.valid).toBe(true);
  });
  it("leaves low-risk intent context to the Planner instead of validating a daily direction", () => {
    const amDecision = {
      ...decision,
      productFitAssessments: {
        ...decision.productFitAssessments,
        selected: [decision.productFitAssessments.selected[1]],
      },
      selected_steps: [
        { ...decision.selected_steps[1], purpose: "hydration_support" as const },
      ],
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [candidates[1]],
      decision: amDecision,
    });
    expect(result).toMatchObject({ valid: true, status: "valid" });
  });
  it("keeps hard factual purposes strict but permits low-risk AI judgments with real evidence", () => {
    expect(validateCarePlannerDecisionDetailed({ ...input, decision: { ...decision, selected_steps: [{ ...decision.selected_steps[0], purpose: "sun_protection" }, decision.selected_steps[1]] } }).valid).toBe(false);
    const aiJudgedTreatment = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: candidates.map((candidate, index) => index === 1
        ? { ...candidate, supportedPurposes: [] }
        : candidate),
      decision: {
        ...decision,
        productFitAssessments: {
          ...decision.productFitAssessments,
          selected: [
            decision.productFitAssessments.selected[0],
            { ...decision.productFitAssessments.selected[1], supportedPurposes: [] },
          ],
        },
        selected_steps: [
          decision.selected_steps[0],
          { ...decision.selected_steps[1], purpose: "optional_treatment" },
        ],
      },
    });
    expect(aiJudgedTreatment).toMatchObject({ valid: true });
    expect(validateCarePlannerDecisionDetailed({
      ...input,
      decision: {
        ...decision,
        selected_steps: [
          { ...decision.selected_steps[0], evidence_refs: ["invented"] },
          decision.selected_steps[1],
        ],
      },
    })).toMatchObject({ valid: false, reason: "SELECTED_PRODUCT_FACT_UNSUPPORTED" });
    const sanitized = validateCarePlannerDecisionDetailed({ ...input, decision: { ...decision, selected_steps: [{ ...decision.selected_steps[0], evidence_refs: ["invented", "src-1"] }, decision.selected_steps[1]] } });
    expect(sanitized).toMatchObject({ valid: true, status: "valid_with_warnings" });
    if (sanitized.valid) {
      expect(sanitized.decision.selected_steps[0].evidence_refs).toEqual(["src-1"]);
      expect(sanitized.warnings).toContainEqual({ code: "EVIDENCE_REFERENCE_DROPPED", ids: ["invented"] });
    }
  });
  it("does not persist verified provenance language for candidate evidence", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      decision: {
        ...decision,
        selected_steps: decision.selected_steps.map((step, index) => index === 1
          ? { ...step, why_this_product: "该产品有verified source支持。" }
          : step),
      },
    });
    expect(result).toMatchObject({ valid: true, status: "valid_with_warnings" });
    if (result.valid) {
      expect(result.decision.selected_steps[1].why_this_product).not.toMatch(/verified/iu);
      expect(result.warnings).toContainEqual({
        code: "PRODUCT_NARRATIVE_SANITIZED",
        ids: [candidates[1].ownedProductId],
      });
    }
  });
  it("requires selected fit coverage but sanitizes non-critical skin references", () => {
    const missingFit = validateCarePlannerDecisionDetailed({
      ...input,
      decision: { ...decision, productFitAssessments: { ...decision.productFitAssessments, selected: [decision.productFitAssessments.selected[0]] } },
    });
    expect(missingFit).toMatchObject({ valid: false, reason: "SELECTED_FIT_ASSESSMENT_COVERAGE_INVALID" });
    const inventedSkinFact = validateCarePlannerDecisionDetailed({
      ...input,
      decision: {
        ...decision,
        productFitAssessments: {
          ...decision.productFitAssessments,
          selected: decision.productFitAssessments.selected.map((assessment) => ({
            ...assessment,
            relevantSkinSignals: ["skin-invented"],
          })),
        },
      },
    });
    expect(inventedSkinFact).toMatchObject({ valid: true, status: "valid_with_warnings" });
    if (inventedSkinFact.valid) {
      expect(inventedSkinFact.decision.productFitAssessments.selected[0].relevantSkinSignals).toEqual([]);
      expect(inventedSkinFact.warnings).toContainEqual({
        code: "SKIN_SIGNAL_REFERENCE_DROPPED",
        ids: ["skin-invented"],
      });
    }
  });
  it("normalizes copied fit purposes instead of requiring a full candidate-purpose mirror", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      decision: {
        ...decision,
        productFitAssessments: {
          ...decision.productFitAssessments,
          selected: decision.productFitAssessments.selected.map((assessment) => ({
            ...assessment,
            supportedPurposes: [],
          })),
        },
      },
    });
    expect(result).toMatchObject({ valid: true, status: "valid_with_warnings" });
    if (result.valid) {
      expect(result.decision.productFitAssessments.selected[1].supportedPurposes).toContain("basic_moisturization");
    }
  });
  it("drops an invalid unselected alternative without rejecting selected products", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      decision: {
        ...decision,
        productFitAssessments: {
          ...decision.productFitAssessments,
          topAlternatives: [{
            ownedProductId: "50000000-0000-4000-8000-000000000099",
            fitLevel: "weak",
            supportedPurposes: [],
            shortReason: "资料不足，未纳入今天方案。",
            uncertainty: ["没有可核对的候选产品。"],
          }],
        },
      },
    });
    expect(result).toMatchObject({ valid: true, status: "valid_with_warnings" });
    if (result.valid) {
      expect(result.warnings).toContainEqual({
        code: "TOP_ALTERNATIVE_DROPPED",
        ids: ["50000000-0000-4000-8000-000000000099"],
      });
      expect(result.decision.productFitAssessments.topAlternatives).toEqual([]);
    }
  });
  it("keeps same-purpose steps and records a potential redundancy instead of rewriting Planner selection", () => {
    const alternative = {
      ...candidates[1],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "补水精华水",
    };
    const duplicateStep = {
      ...decision.selected_steps[1],
      ownedProductId: alternative.ownedProductId,
      purpose: "hydration_support" as const,
      value_if_removed: "会失去这一补水支持。",
    };
    const hydrationStep = {
      ...decision.selected_steps[1],
      purpose: "hydration_support" as const,
      value_if_removed: "会失去这一补水支持。",
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [...candidates, alternative],
      decision: {
        ...decision,
        selected_steps: [decision.selected_steps[0], hydrationStep, duplicateStep],
        productFitAssessments: {
          ...decision.productFitAssessments,
          selected: [
            ...decision.productFitAssessments.selected,
            { ...decision.productFitAssessments.selected[1], ownedProductId: alternative.ownedProductId },
          ],
        },
        candidateComparisons: [{
          purpose: "hydration_support",
          candidateIds: [candidates[1].ownedProductId, alternative.ownedProductId],
          selectedProductIds: [alternative.ownedProductId],
          selectionMode: "single",
          comparisonReason: "补水精华水是更好的选择。",
          multipleSelectionReason: null,
          uncertainty: ["没有证据证明两者存在明显优劣。"],
        }],
      },
    });
    expect(result).toMatchObject({ valid: true, status: "valid_with_warnings" });
    if (result.valid) {
      expect(result.selectedSteps).toContainEqual({
        ownedProductId: alternative.ownedProductId,
        purpose: "hydration_support",
      });
      expect(result.selectedSteps).toContainEqual({
        ownedProductId: candidates[1].ownedProductId,
        purpose: "hydration_support",
      });
      expect(result.warnings).toContainEqual({
        code: "POTENTIAL_REDUNDANCY",
        ids: [candidates[1].ownedProductId, alternative.ownedProductId],
      });
      expect(result.warnings).toContainEqual({
        code: "COMPARISON_LANGUAGE_SANITIZED",
        ids: [alternative.ownedProductId],
      });
      expect(result.decision.candidateComparisons?.[0]?.comparisonReason).toBe("今天更偏向补水精华水。");
    }
  });
  it("retains complementary same-purpose products when Planner states distinct incremental value", () => {
    const alternative = {
      ...candidates[1],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "按需补水喷雾",
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [...candidates, alternative],
      decision: {
        ...decision,
        selected_steps: [
          decision.selected_steps[0],
          { ...decision.selected_steps[1], purpose: "hydration_support" as const, value_if_removed: "会失去基础补水支持。" },
          { ...decision.selected_steps[1], ownedProductId: alternative.ownedProductId, purpose: "hydration_support" as const, value_if_removed: "会失去白天按需补水方式。" },
        ],
        productFitAssessments: {
          ...decision.productFitAssessments,
          selected: [
            ...decision.productFitAssessments.selected,
            { ...decision.productFitAssessments.selected[1], ownedProductId: alternative.ownedProductId },
          ],
        },
        candidateComparisons: [{
          purpose: "hydration_support",
          candidateIds: [candidates[1].ownedProductId, alternative.ownedProductId],
          selectedProductIds: [candidates[1].ownedProductId, alternative.ownedProductId],
          selectionMode: "complementary_multiple",
          comparisonReason: "一款固定使用，一款仅在日间按需补充。",
          multipleSelectionReason: "使用时机不同，并非固定叠加。",
          uncertainty: ["两者没有直接头对头证据。"],
        }],
      },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.selectedSteps.filter((step) => step.purpose === "hydration_support")).toHaveLength(2);
      expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: "POTENTIAL_REDUNDANCY" }));
    }
  });

  it("keeps a Planner-declared optional hydration omission only when the purpose was considered and unselected", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      consideredPurposes: ["hydration_support"],
      decision: {
        ...decision,
        purposeOmissions: [
          { purpose: "hydration_support", reason: "not_needed_today" },
          { purpose: "hydration_support", reason: "not_needed_today" },
        ],
      },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.purposeOmissions).toEqual([
        { purpose: "hydration_support", reason: "not_needed_today" },
      ]);
      expect(result.warnings).toContainEqual(expect.objectContaining({
        code: "PURPOSE_OMISSION_DROPPED",
        ids: ["hydration_support"],
      }));
    }
  });

  it("derives omission reasons from the existing step limit, eligibility, and hard restriction facts", () => {
    const atStepLimit = validateCarePlannerDecisionDetailed({
      ...input,
      maxSteps: 2,
      consideredPurposes: ["optional_treatment"],
      decision,
    });
    expect(atStepLimit).toMatchObject({ valid: true, decision: { purposeOmissions: [
      { purpose: "optional_treatment", reason: "deferred_by_step_limit" },
    ] } });

    const cleansingOnly = {
      ...decision,
      selected_steps: [decision.selected_steps[0]],
      productFitAssessments: { selected: [decision.productFitAssessments.selected[0]], topAlternatives: [] },
    };
    const withoutEligibleEvidence = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [candidates[0]],
      consideredPurposes: ["optional_treatment"],
      decision: cleansingOnly,
    });
    expect(withoutEligibleEvidence).toMatchObject({ valid: true, decision: { purposeOmissions: [
      { purpose: "optional_treatment", reason: "no_eligible_evidence" },
    ] } });

    const hardRestricted = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [candidates[0]],
      hardRestrictions: ["REDUCE_TREATMENT"],
      consideredPurposes: ["optional_treatment"],
      decision: {
        ...cleansingOnly,
        purposeOmissions: [{ purpose: "optional_treatment", reason: "not_needed_today" }],
      },
    });
    expect(hardRestricted).toMatchObject({ valid: true, decision: { purposeOmissions: [
      { purpose: "optional_treatment", reason: "hard_restricted" },
    ] } });
  });

  it("does not allow a comparison path to bypass an existing hard restriction", () => {
    const selectedTreatment: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[1],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      productType: "treatment",
      supportedPurposes: ["optional_treatment"],
      productEvidence: { ...candidates[1].productEvidence, productType: "treatment", supportedPurposes: ["optional_treatment"] },
    };
    const alternativeTreatment: CarePlannerInput["eligibleProducts"][number] = {
      ...selectedTreatment,
      ownedProductId: "50000000-0000-4000-8000-000000000004",
      displayName: "另一款针对性护理",
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [selectedTreatment, alternativeTreatment],
      hardRestrictions: ["REDUCE_TREATMENT"],
      decision: {
        ...decision,
        selected_steps: [{
          ...decision.selected_steps[0],
          ownedProductId: selectedTreatment.ownedProductId,
          purpose: "optional_treatment",
          selection_rationale: {
            candidateIds: [selectedTreatment.ownedProductId, alternativeTreatment.ownedProductId],
            selectedProductId: selectedTreatment.ownedProductId,
            relevantDifferences: ["两款已有产品信息不同。"],
            whySelectedToday: "今天更偏向第一款。",
            certainty: "clear",
          },
        }],
        productFitAssessments: {
          selected: [{
            ...decision.productFitAssessments.selected[0],
            ownedProductId: selectedTreatment.ownedProductId,
            supportedPurposes: ["optional_treatment"],
          }],
          topAlternatives: [],
        },
        candidateComparisons: [{
          purpose: "optional_treatment",
          candidateIds: [selectedTreatment.ownedProductId, alternativeTreatment.ownedProductId],
          selectedProductIds: [selectedTreatment.ownedProductId],
          selectionMode: "single",
          comparisonReason: "今天更偏向第一款。",
          multipleSelectionReason: null,
          uncertainty: ["仅作情境比较。"],
        }],
      },
    });
    expect(result).toMatchObject({ valid: false, reason: "TREATMENT_HARD_RESTRICTED" });
  });

  it("drops omissions for selected or unconsidered purposes without rejecting the routine", () => {
    const selectedPurpose = validateCarePlannerDecisionDetailed({
      ...input,
      consideredPurposes: ["cleansing"],
      decision: { ...decision, purposeOmissions: [{ purpose: "cleansing", reason: "not_needed_today" }] },
    });
    expect(selectedPurpose).toMatchObject({
      valid: true,
      decision: { purposeOmissions: [] },
      warnings: [expect.objectContaining({ code: "PURPOSE_OMISSION_DROPPED", ids: ["cleansing"] })],
    });

    const unconsideredPurpose = validateCarePlannerDecisionDetailed({
      ...input,
      consideredPurposes: [],
      decision: { ...decision, purposeOmissions: [{ purpose: "hydration_support", reason: "not_needed_today" }] },
    });
    expect(unconsideredPurpose).toMatchObject({
      valid: true,
      decision: { purposeOmissions: [] },
      warnings: [expect.objectContaining({ code: "PURPOSE_OMISSION_DROPPED", ids: ["hydration_support"] })],
    });
  });

  it("does not let a Planner-proposed deterministic omission reason override facts", () => {
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      consideredPurposes: ["hydration_support"],
      decision: {
        ...decision,
        purposeOmissions: [{ purpose: "hydration_support", reason: "deferred_by_step_limit" }],
      },
    });

    expect(result).toMatchObject({
      valid: true,
      decision: { purposeOmissions: [] },
      warnings: [expect.objectContaining({
        code: "PURPOSE_OMISSION_DROPPED",
        ids: ["hydration_support"],
      })],
    });
  });

  it("preserves a valid comparison subset when a third cleanser has only baseline evidence", () => {
    const evidenceBackedAlternative = {
      ...candidates[0],
      ownedProductId: "50000000-0000-4000-8000-000000000003",
      displayName: "另一款有资料的洁面",
    };
    const insufficientAlternative: CarePlannerInput["eligibleProducts"][number] = {
      ...candidates[0],
      ownedProductId: "50000000-0000-4000-8000-000000000004",
      displayName: "基础洁面",
      supportedPurposes: [],
      baselineTypeBackedPurposes: ["cleansing"],
      productEvidence: {
        ...candidates[0].productEvidence,
        supportedPurposes: [], evidenceRefs: [], sourceRefs: [], usableSkincareEvidence: false,
      },
    };
    const result = validateCarePlannerDecisionDetailed({
      ...input,
      candidates: [...candidates, evidenceBackedAlternative, insufficientAlternative],
      decision: {
        ...decision,
        selected_steps: [{
          ...decision.selected_steps[0],
          selection_rationale: {
            candidateIds: [candidates[0].ownedProductId, evidenceBackedAlternative.ownedProductId, insufficientAlternative.ownedProductId],
            selectedProductId: candidates[0].ownedProductId,
            relevantDifferences: ["今天更需要不过度清洁的肤感。"],
            whySelectedToday: "今天优先保留清洁后更轻松的安排。",
            certainty: "clear",
          },
        }, decision.selected_steps[1]],
      },
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.decision.selected_steps[0]?.selection_rationale).toMatchObject({
      candidateIds: [candidates[0].ownedProductId, evidenceBackedAlternative.ownedProductId],
      comparisonMode: "strong",
      whySelectedToday: "今天优先保留清洁后更轻松的安排。",
    });
  });
});
