import { describe, expect, it } from "vitest";

import { consumerFacingClaimTexts } from "@/features/admin/product-knowledge-maintenance-form";

describe("Product Knowledge Admin language presentation", () => {
  it("prefers Chinese normalized claims without replacing source-language raw claims", () => {
    const claims = [{
      raw_text: "Helps refine the appearance of pores",
      normalized_claim: "帮助改善毛孔外观",
      confidence: 88,
      evidence_refs: ["source_1"],
    }];

    expect(consumerFacingClaimTexts(claims)).toEqual(["帮助改善毛孔外观"]);
    expect(claims[0]?.raw_text).toBe("Helps refine the appearance of pores");
  });

  it("does not relabel historical English normalized text as Chinese presentation", () => {
    expect(consumerFacingClaimTexts([{
      raw_text: "一夜改善倦容",
      normalized_claim: "Reduces signs of fatigue overnight",
      confidence: 80,
      evidence_refs: ["source_1"],
    }, {
      raw_text: "English source claim",
      normalized_claim: null,
      confidence: 80,
      evidence_refs: ["source_2"],
    }])).toEqual(["一夜改善倦容"]);
  });
});
