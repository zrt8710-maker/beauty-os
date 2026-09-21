import { describe, expect, it, vi } from "vitest";

import type { TodayUserNarrativeInput } from "@/server/services/today-user-narrative-service";
import { createVolcengineTodayUserNarrativeProvider } from "@/server/services/volcengine-today-user-narrative-provider";

const input: TodayUserNarrativeInput = {
  period: "pm",
  softPersonalization: { texturePreferences: [], skinGoals: [] },
  steps: [],
};

describe("Volcengine Today user narrative provider", () => {
  it("sends only the bounded explanation context for the selected product and validated alternative", async () => {
    const richInput: TodayUserNarrativeInput = {
      period: "am",
      softPersonalization: { texturePreferences: ["轻薄"], skinGoals: [] },
      purposeOmissions: [],
      steps: [{
        ownedProductId: "10000000-0000-4000-8000-000000000001",
        productName: "当前防晒",
        purpose: "sun_protection",
        whyToday: "今天紫外线指数较高，需要完成防晒。",
        whyThisProduct: "轻薄乳液质地符合今天的使用安排。",
        relevantSkinContext: [{ concern: "dryness", area: "cheeks", timeframe: "baseline", comparison: null }],
        relevantWeatherContext: [{ metric: "紫外线指数", value: 8 }],
        recentExperience: { positiveSignals: [], preferenceIssues: [], summary: null },
        relevantMemoryContext: [],
        relevantRoutineRolePreferences: [{ scope: "routine_role", period: "am", routine_role: "sunscreen", polarity: "prefer" }],
        productFacts: {
          productType: "防晒",
          capabilities: ["防晒"],
          claims: ["广谱防晒"],
          texture: ["轻薄乳液"],
          usage: ["出门前均匀使用"],
          cautions: [],
          consumerIngredients: ["烟酰胺"],
          ingredientKnowledge: [],
        },
        selectionRationale: {
          comparableCandidateCount: 2,
          relevantDifferences: ["当前防晒是轻薄乳液，另一款偏滋润"],
          whySelectedToday: "今天更偏向轻薄乳液质地。",
          certainty: "clear",
          comparisonMode: "strong",
          comparableProducts: [{
            ownedProductId: "10000000-0000-4000-8000-000000000002",
            productName: "另一款真实防晒",
            productFacts: {
              productType: "防晒",
              capabilities: ["防晒"],
              claims: ["防水耐汗"],
              texture: ["偏滋润"],
              usage: ["户外活动前使用"],
              cautions: [],
              consumerIngredients: [],
              ingredientKnowledge: [],
            },
          }],
          validatedComparisonReason: "两瓶都能防晒，今天按质地偏好选择。",
        },
      }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ entries: [{
        ownedProductId: richInput.steps[0]!.ownedProductId,
        reason: "今天紫外线指数较高，需要完成防晒；当前防晒有广谱防晒描述，轻薄乳液质地也符合今天的使用安排。",
        comparison_note: "另一款真实防晒偏向防水耐汗；今天更偏向当前防晒的轻薄乳液质地。",
        usage: "出门前均匀使用。",
      }], purposeOmissions: [] }),
    }), { status: 200 }));
    const provider = createVolcengineTodayUserNarrativeProvider({
      apiKey: "test-key", model: "test-model", baseUrl: "https://example.test", fetchImpl,
    });

    await provider.narrate(richInput);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    const sentContext = JSON.parse(request.input[0].content[0].text);
    expect(sentContext.steps[0].selectionRationale.comparableProducts).toEqual([
      expect.objectContaining({ productName: "另一款真实防晒", productFacts: expect.objectContaining({ claims: ["防水耐汗"] }) }),
    ]);
    expect(JSON.stringify(sentContext)).not.toMatch(/sourceRefs|evidenceRefs|provenance|confidence|unknownFields|usableSkincareEvidence/u);
    expect(request.instructions).toContain("Ordinary non-medical care background may be stated generically");
    expect(request.instructions).toContain("Never rewrite that background as an unsupported observation");
    expect(request.instructions).toContain("Consumer value has this priority");
    expect(request.instructions).toContain("If the alternative has only a supplied facial-cleansing product type or usage fact");
    expect(request.instructions).toContain("whySelectedToday and relevantDifferences as the primary decision trace");
    expect(request.instructions).toContain("relevant preference or actual experience");
    expect(request.instructions).toContain("never as dislike or preference for the selected product");
    expect(sentContext.steps[0].relevantRoutineRolePreferences).toEqual([{ scope: "routine_role", period: "am", routine_role: "sunscreen", polarity: "prefer" }]);
    expect(JSON.stringify(sentContext)).not.toContain("inventoryContext");
    expect(request.instructions).toContain("Partial Product Knowledge is expected");
    expect(request.instructions).toContain("Never treat missing knowledge");
    expect(sentContext.steps[0]).toEqual(expect.objectContaining({
      whyThisProduct: "轻薄乳液质地符合今天的使用安排。",
      selectionRationale: expect.objectContaining({
        relevantDifferences: ["当前防晒是轻薄乳液，另一款偏滋润"],
        whySelectedToday: "今天更偏向轻薄乳液质地。",
        validatedComparisonReason: "两瓶都能防晒，今天按质地偏好选择。",
      }),
    }));
    expect(request.instructions).not.toContain("Do not add generic events such as oil, dust, residue");
  });

  it("concatenates only output_text segments before parsing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        status: "completed",
        content: [
          { type: "reasoning", text: "not-consumer-output" },
          { type: "output_text", text: '{"entries":[],' },
          { type: "output_text", text: '"purposeOmissions":[]}' },
        ],
      }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 }));
    const provider = createVolcengineTodayUserNarrativeProvider({
      apiKey: "test-key", model: "test-model", baseUrl: "https://example.test", fetchImpl,
    });

    await expect(provider.narrate(input)).resolves.toEqual({ entries: [], purposeOmissions: [] });
  });

  it("classifies a HTTP 200 truncated output without attempting another model call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"entries":[{"ownedProductId":"',
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 }));
    const provider = createVolcengineTodayUserNarrativeProvider({
      apiKey: "test-key", model: "test-model", baseUrl: "https://example.test", fetchImpl,
    });

    await expect(provider.narrate(input)).rejects.toMatchObject({
      subtype: "incomplete_or_truncated",
      details: {
        responseStatus: 200,
        finishReason: null,
        incompleteReason: "max_output_tokens",
        outputTextSegmentCount: 1,
        outputChars: expect.any(Number),
        inputTokens: 10,
        outputTokens: 5,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
