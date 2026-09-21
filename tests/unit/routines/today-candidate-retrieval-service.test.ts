import { describe, expect, it } from "vitest";

import type { DailyCareNeeds } from "@/server/domain/daily-care-needs";
import { emptyPlannerProductEvidence } from "@/server/services/planner-product-evidence-service";
import {
  compactPlannerCandidates,
  shortlistCarePlannerCandidates,
} from "@/server/services/today-candidate-retrieval-service";
import type { CarePlannerInput } from "@/server/services/today-care-planner-service";

type Candidate = CarePlannerInput["eligibleProducts"][number];

describe("Today candidate retrieval", () => {
  it("continues round-robin past an initial nine representatives while legal candidates remain", () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) => neutralCandidate(index, "basic_moisturization")),
      ...Array.from({ length: 5 }, (_, index) => neutralCandidate(index + 5, "hydration_support")),
      ...Array.from({ length: 5 }, (_, index) => neutralCandidate(index + 10, "optional_treatment")),
    ];

    const result = shortlistCarePlannerCandidates({
      candidates,
      period: "pm",
      dailyCareNeeds: needs(),
    });

    expect(result.candidates).toHaveLength(12);
    expect(new Set(result.candidates.map((item) => item.ownedProductId))).toHaveLength(12);
  });

  it("stops below the cap when every purpose cursor is genuinely exhausted", () => {
    const noPurposeCandidate = neutralCandidate(50, "sun_protection", {
      supportedPurposes: [],
      baselineTypeBackedPurposes: [],
      productType: "sunscreen",
      productEvidence: emptyPlannerProductEvidence(),
    });

    const result = shortlistCarePlannerCandidates({
      candidates: [noPurposeCandidate],
      period: "pm",
      dailyCareNeeds: needs(),
    });

    expect(result.candidates).toEqual([]);
    expect(result.candidates.length).toBeLessThan(12);
  });

  it("counts a multi-purpose product once while other purpose cursors continue", () => {
    const shared = neutralCandidate(60, "basic_moisturization", {
      supportedPurposes: ["basic_moisturization", "hydration_support"],
    });
    const candidates = [
      shared,
      ...Array.from({ length: 12 }, (_, index) => neutralCandidate(index + 61, "hydration_support")),
    ];

    const result = shortlistCarePlannerCandidates({
      candidates,
      period: "pm",
      dailyCareNeeds: needs(),
    });
    const ids = result.candidates.map((item) => item.ownedProductId);

    expect(ids.filter((id) => id === shared.ownedProductId)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.candidates).toHaveLength(12);
  });

  it("scans past selected rank zero through two to reach the next new candidate", () => {
    const firstThree = Array.from({ length: 3 }, (_, index) => neutralCandidate(index + 80, "hydration_support", {
      supportedPurposes: ["basic_moisturization", "hydration_support"],
    }));
    const rankThree = neutralCandidate(83, "hydration_support", {
      supportedPurposes: ["basic_moisturization", "hydration_support"],
    });

    const result = shortlistCarePlannerCandidates({
      candidates: [...firstThree, rankThree],
      period: "pm",
      dailyCareNeeds: needs(),
    });

    expect(result.candidates).toContainEqual(expect.objectContaining({
      ownedProductId: rankThree.ownedProductId,
    }));
  });

  it("bounds a 36-product inventory independently of inventory size and keeps the incumbent", () => {
    const candidates = Array.from({ length: 36 }, (_, index) => candidate(index));
    const incumbent = candidates[35]!;
    const result = shortlistCarePlannerCandidates({
      candidates,
      period: "pm",
      dailyCareNeeds: needs(),
      incumbentOwnedProductIds: new Set([incumbent.ownedProductId]),
      texturePreferences: ["lightweight"],
    });
    expect(result.candidates.length).toBeLessThanOrEqual(12);
    expect(result.candidates).toContainEqual(expect.objectContaining({ ownedProductId: incumbent.ownedProductId }));
    expect(result.gaps).toEqual([]);
  });

  it("does not exclude partial knowledge when real source-backed facts can serve an ordinary purpose", () => {
    const partial = candidate(1, {
      supportedPurposes: [],
      productEvidence: {
        ...emptyPlannerProductEvidence(),
        productType: "serum",
        claims: [{ text: "补水精华", evidenceRefs: ["partial-source"] }],
        evidenceRefs: ["partial-source"],
        usableSkincareEvidence: true,
        provenance: "draft_derived",
        knownFacts: ["productType", "claims"],
        unknownFields: ["texture", "usage", "cautions", "ingredients"],
        limitations: ["部分资料待补充"],
      },
    });
    const result = shortlistCarePlannerCandidates({
      candidates: [partial],
      period: "pm",
      dailyCareNeeds: needs(),
    });

    expect(result.candidates).toContainEqual(expect.objectContaining({ ownedProductId: partial.ownedProductId }));
    expect(result.purposesByOwnedProductId.get(partial.ownedProductId)).toContain("hydration_support");
  });

  it("reserves an AM shortlist slot for sun protection before optional candidates fill the cap", () => {
    const nonSunCandidates = Array.from({ length: 18 }, (_, index) => candidate(index, {
      supportedPurposes: ["hydration_support"],
      productType: "serum",
    }));
    const sunscreen = candidate(99, {
      supportedPurposes: ["sun_protection"],
      productType: "sunscreen",
      productEvidence: {
        ...candidate(99).productEvidence,
        productType: "sunscreen",
        supportedPurposes: ["sun_protection"],
      },
    });
    const result = shortlistCarePlannerCandidates({
      candidates: [...nonSunCandidates, sunscreen],
      period: "am",
      dailyCareNeeds: needs(),
    });

    expect(result.candidates.length).toBeLessThanOrEqual(12);
    expect(result.candidates).toContainEqual(expect.objectContaining({ ownedProductId: sunscreen.ownedProductId }));
    expect(result.gaps).toEqual([]);
  });

  it("reports a required-purpose gap from the final shortlist", () => {
    const result = shortlistCarePlannerCandidates({
      candidates: Array.from({ length: 16 }, (_, index) => candidate(index, {
        supportedPurposes: ["hydration_support"],
        productType: "serum",
      })),
      period: "am",
      dailyCareNeeds: needs(),
    });

    expect(result.candidates.length).toBeLessThanOrEqual(12);
    expect(result.gaps).toEqual(["sun_protection"]);
  });

  it("projects purpose-relevant evidence without removing the facts needed for comparison", () => {
    const full = candidate(2, {
      productEvidence: {
        ...emptyPlannerProductEvidence(),
        productType: "moisturizer",
        claims: [
          { text: "补水并支持皮肤屏障", evidenceRefs: ["hydration"] },
          { text: "广告历史介绍一", evidenceRefs: ["history-1"] },
          { text: "广告历史介绍二", evidenceRefs: ["history-2"] },
          { text: "广告历史介绍三", evidenceRefs: ["history-3"] },
        ],
        usage: { instructions: ["晚间洁面后使用", "可厚涂", "可用于身体"], cautions: ["避开眼周", "出现不适停止使用", "仅供外用"], evidenceRefs: ["usage"] },
        texture: { description: "轻薄乳液质地", evidenceRefs: ["texture"] },
        supportedPurposes: ["basic_moisturization", "hydration_support"],
        evidenceRefs: ["hydration", "history-1", "history-2", "history-3", "usage", "texture"],
        usableSkincareEvidence: true,
        provenance: "draft_derived",
        knownFacts: ["productType", "claims", "texture", "usage", "cautions"],
        unknownFields: ["ingredients"],
        limitations: ["成分未知", "第二条限制", "第三条限制"],
      },
    });
    const compact = compactPlannerCandidates({
      candidates: [full],
      purposesByOwnedProductId: new Map([[full.ownedProductId, ["basic_moisturization", "hydration_support"]]]),
      dailyCareNeeds: needs(),
      period: "pm",
    })[0]!;

    expect(compact.productEvidence.claims).toHaveLength(3);
    expect(compact.productEvidence.claims[0]?.text).toContain("补水");
    expect(compact.productEvidence.texture?.description).toContain("轻薄");
    expect(compact.productEvidence.usage?.instructions.length).toBeLessThanOrEqual(2);
    expect(compact.productEvidence.limitations).toHaveLength(2);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length);
  });
});

function needs(): DailyCareNeeds {
  return {
    priorities: [{ code: "hydration", level: "high", weight: 80, reasonCodes: ["TODAY_DRYNESS_HIGH"] }],
    requiredRoles: ["cleanser", "moisturizer"],
    optionalRoles: ["hydration", "treatment"],
    restrictions: [], reasons: [], unknowns: [],
  };
}

function candidate(index: number, override: Partial<Candidate> = {}): Candidate {
  const purpose = index % 5 === 0
    ? "cleansing"
    : index % 5 === 1
      ? "basic_moisturization"
      : index % 5 === 2
        ? "hydration_support"
        : index % 5 === 3
          ? "sun_protection"
          : "optional_treatment";
  const productType = purpose === "cleansing" ? "cleanser"
    : purpose === "sun_protection" ? "sunscreen"
      : purpose === "basic_moisturization" ? "moisturizer" : "serum";
  const evidence = {
    ...emptyPlannerProductEvidence(),
    productType: productType as Candidate["productEvidence"]["productType"],
    claims: [{ text: `${purpose} lightweight`, evidenceRefs: [`source-${index}`] }],
    texture: { description: index % 2 === 0 ? "lightweight lotion" : "rich cream", evidenceRefs: [`source-${index}`] },
    supportedPurposes: [purpose] as Candidate["supportedPurposes"],
    evidenceRefs: [`source-${index}`],
    usableSkincareEvidence: true,
    provenance: "draft_derived" as const,
    knownFacts: ["productType", "claims", "texture"] as Candidate["knownFacts"],
    unknownFields: ["usage", "cautions", "ingredients"] as Candidate["unknownFields"],
    limitations: ["部分资料待补充"],
  };
  return {
    ownedProductId: `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    displayName: `Product ${index + 1}`,
    productType,
    productEvidence: evidence,
    knownFacts: evidence.knownFacts,
    unknownFields: evidence.unknownFields,
    limitations: evidence.limitations,
    supportedPurposes: [purpose],
    baselineTypeBackedPurposes: [],
    inventory: { quantityPercent: index % 7 === 0 ? 20 : 80 },
    usageHistory: {
      usageCount: index % 4,
      averageRating: index % 6 === 0 ? 5 : null,
      positiveSignals: index % 6 === 0 ? ["多次体验较稳定"] : [],
      preferenceIssues: [],
      highReactionCount: 0,
      recentRelevantFeedbackSummary: null,
    },
    ...override,
  };
}

function neutralCandidate(
  index: number,
  purpose: Candidate["supportedPurposes"][number],
  override: Partial<Candidate> = {},
) {
  return candidate(index, {
    inventory: { quantityPercent: 80 },
    usageHistory: {
      usageCount: 0,
      averageRating: null,
      positiveSignals: [],
      preferenceIssues: [],
      highReactionCount: 0,
      recentRelevantFeedbackSummary: null,
    },
    supportedPurposes: [purpose],
    ...override,
  });
}
