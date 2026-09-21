import { describe, expect, it, vi } from "vitest";

import { createTodayUserNarrativeService, type TodayUserNarrativeInput } from "@/server/services/today-user-narrative-service";

const input: TodayUserNarrativeInput = {
  period: "pm",
  softPersonalization: { texturePreferences: ["轻薄"], skinGoals: ["补水保湿"] },
  steps: [{ ownedProductId: "10000000-0000-4000-8000-000000000001", productName: "POLA · 黑 BA 洁面奶", purpose: "cleansing", whyToday: "基础清洁", whyThisProduct: "泡沫和洗后不紧绷的特点符合今晚的清洁安排", relevantSkinContext: [{ concern: "oiliness", area: "t_zone", timeframe: "baseline", comparison: null }], relevantWeatherContext: [], recentExperience: { positiveSignals: ["多次体验较稳定"], preferenceIssues: [], summary: "近期用后感觉舒适。" }, relevantMemoryContext: [], productFacts: { productType: "洁面", capabilities: ["清洁"], claims: ["洁后不紧绷"], texture: ["膏状可起泡"], usage: [], cautions: [], consumerIngredients: ["癸基葡糖苷"] }, selectionRationale: { comparableCandidateCount: 2, relevantDifferences: ["POLA 可起泡且有洗后不紧绷的特点", "另一款洁面可用于日常面部清洁"], whySelectedToday: "今晚需要兼顾清洁感与洗后舒适感", certainty: "uncertain", comparisonMode: "strong", comparableProducts: [{ ownedProductId: "10000000-0000-4000-8000-000000000002", productName: "另一款洁面", productFacts: { productType: "洁面", capabilities: [], claims: [], texture: [], usage: ["用于日常面部清洁"], cautions: [], consumerIngredients: [], ingredientKnowledge: [] } }], validatedComparisonReason: "今晚更偏向有实际使用经验的 POLA" } }],
};

describe("Today user narrative service", () => {
  it("keeps a complete generation-time narrative only for the validated selected steps", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{ ownedProductId: input.steps[0]!.ownedProductId, reason: "你平时 T 区容易出油，今晚先完成一次不过度的清洁。产品有洁后不紧绷的描述，配方资料里还能看到癸基葡糖苷。", comparison_note: "两款都能完成基础清洁，但今晚更偏向洗后感觉轻松的一款。", usage: "充分起泡后轻柔洗净即可。" }] }) };
    await expect(createTodayUserNarrativeService(provider).narrate(input)).resolves.toMatchObject({
      entries: [{ ownedProductId: input.steps[0]!.ownedProductId, reason: expect.stringContaining("癸基葡糖苷"), usage: expect.stringContaining("起泡") }],
    });
    expect(provider.narrate).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({
        selectionRationale: expect.objectContaining({ comparableCandidateCount: 2 }),
      })],
    }));
  });

  it("drops incomplete output instead of affecting the validated routine", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [] }) };
    await expect(createTodayUserNarrativeService(provider).narrate(input)).resolves.toBeNull();
  });

  it("drops technical audit language before it can enter the saved consumer projection", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{ ownedProductId: input.steps[0]!.ownedProductId, reason: "现有 evidence 支持这一步。", comparison_note: "两款都可以，但今晚更偏向这一款。", usage: "取适量使用即可。" }] }) };
    await expect(createTodayUserNarrativeService(provider).narrate(input)).resolves.toBeNull();
  });

  it("neutralizes candidate-language locally and retains an otherwise safe narration", async () => {
    const rawReason = "今晚以基础清洁为主，这款在候选产品中更符合不过度清洁的安排。";
    const rawComparison = "其他产品也可以，但今晚先用这款。";
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: rawReason,
      comparison_note: rawComparison,
      usage: "取适量起泡后轻柔洗净即可。",
    }] }) };

    const result = await createTodayUserNarrativeService(provider).narrate(input);

    expect(rawReason).toMatch(/候选/u);
    expect(rawComparison).toMatch(/其他产品也可以/u);
    expect(result).toEqual({ entries: [expect.objectContaining({
      reason: expect.stringContaining("另一件产品"),
      comparison_note: expect.stringContaining("另一件产品也并非不适合"),
      usage: "取适量起泡后轻柔洗净即可。",
    })] });
    expect(JSON.stringify(result)).not.toMatch(/候选|其他产品也可以/u);
  });

  it("keeps only the validator-owned purpose omission reason supplied to narration", async () => {
    const withOmission = {
      ...input,
      purposeOmissions: [{ purpose: "hydration_support" as const, reason: "not_needed_today" as const }],
    };
    const provider = { narrate: vi.fn().mockResolvedValue({
      entries: [{
        ownedProductId: input.steps[0]!.ownedProductId,
        reason: "今晚以基础清洁为主。",
        comparison_note: "两款都能完成基础清洁，但今晚更偏向这款轻松的使用感。",
        usage: "取适量起泡后轻柔洗净即可。",
      }],
      purposeOmissions: [{
        purpose: "hydration_support",
        reason: "not_needed_today",
        message: "今天没有额外加入补水步骤，当前方案已经覆盖主要护理方向。",
      }],
    }) };

    await expect(createTodayUserNarrativeService(provider).narrate(withOmission)).resolves.toMatchObject({
      purposeOmissions: [{ purpose: "hydration_support", reason: "not_needed_today" }],
    });

    const inventedReason = { narrate: vi.fn().mockResolvedValue({
      entries: [{
        ownedProductId: input.steps[0]!.ownedProductId,
        reason: "今晚以基础清洁为主。",
        comparison_note: "两款都能完成基础清洁，但今晚更偏向这款轻松的使用感。",
        usage: "取适量起泡后轻柔洗净即可。",
      }],
      purposeOmissions: [{
        purpose: "hydration_support",
        reason: "deferred_by_step_limit",
        message: "今天先保持精简。",
      }],
    }) };
    await expect(createTodayUserNarrativeService(inventedReason).narrate(withOmission)).resolves.toBeNull();
  });

  it("still rejects technical wording after candidate-language neutralization", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "候选产品的 evidence 支持今晚这一步。",
      comparison_note: "其他产品也可以，但今晚先用这款。",
      usage: "取适量起泡后轻柔洗净即可。",
    }] }) };

    await expect(createTodayUserNarrativeService(provider).narrate(input)).resolves.toBeNull();
  });

  it("logs a fixed consumer-boundary subreason without provider text", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{ ownedProductId: input.steps[0]!.ownedProductId, reason: "现有 evidence 支持这一步。", comparison_note: "两款都可以，但今晚更偏向这一款。", usage: "取适量使用即可。" }] }) };
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "development");

    try {
      await expect(createTodayUserNarrativeService(provider).narrate(input)).resolves.toBeNull();
      expect(log).toHaveBeenCalledWith("[today-user-narrative]", expect.objectContaining({
        stage: "narration_rejected",
        reason: "consumer_boundary.evidence_term",
      }));
      expect(JSON.stringify(log.mock.calls)).not.toContain("现有 evidence 支持这一步");
    } finally {
      vi.unstubAllEnvs();
      log.mockRestore();
    }
  });

  it("does not require an ingredient when no consumer-safe ingredient is useful", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{ ownedProductId: input.steps[0]!.ownedProductId, reason: "今晚以基础清洁为主。", comparison_note: "两款都能完成这一步，今晚更偏向这款轻松的使用感。", usage: "取适量起泡后轻柔洗净即可。" }] }) };
    const withoutIngredients = { ...input, steps: [{ ...input.steps[0]!, productFacts: { ...input.steps[0]!.productFacts, consumerIngredients: [] } }] };
    await expect(createTodayUserNarrativeService(provider).narrate(withoutIngredients)).resolves.not.toBeNull();
  });

  it("requires no comparison note when the saved rationale has no genuine competitor", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{ ownedProductId: input.steps[0]!.ownedProductId, reason: "今晚以基础清洁为主。", comparison_note: null, usage: "取适量起泡后轻柔洗净即可。" }] }) };
    const singleCandidate = { ...input, steps: [{ ...input.steps[0]!, selectionRationale: { ...input.steps[0]!.selectionRationale!, comparableCandidateCount: 1 } }] };
    await expect(createTodayUserNarrativeService(provider).narrate(singleCandidate)).resolves.not.toBeNull();
  });

  it("drops a narration that omits a required comparison note", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{ ownedProductId: input.steps[0]!.ownedProductId, reason: "今晚以基础清洁为主。", comparison_note: null, usage: "取适量起泡后轻柔洗净即可。" }] }) };
    await expect(createTodayUserNarrativeService(provider).narrate(input)).resolves.toBeNull();
  });

  it("keeps a lightweight comparison's concrete selection reason without upgrading it", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚以补水为主。",
      comparison_note: "这次先用这款，主要因为轻薄的使用感符合今晚补水后不想增加厚重感的安排。",
      usage: "取适量轻拍至吸收。",
    }] }) };
    const lightweight = { ...input, steps: [{ ...input.steps[0]!, selectionRationale: {
      ...input.steps[0]!.selectionRationale!,
      comparisonMode: "lightweight_contextual" as const,
    } }] };

    await expect(createTodayUserNarrativeService(provider).narrate(lightweight)).resolves.toEqual({
      entries: [expect.objectContaining({
        comparison_note: "这次先用这款，主要因为轻薄的使用感符合今晚补水后不想增加厚重感的安排。",
      })],
    });
    const result = await createTodayUserNarrativeService(provider).narrate(lightweight);
    expect(result?.entries[0]?.comparison_note).not.toMatch(/更适配|更适合|优于|不如/u);
    expect(provider.narrate).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({ selectionRationale: expect.objectContaining({ comparisonMode: "lightweight_contextual" }) })],
    }));

    const upgradedReason = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "这款比另一瓶更好。",
      comparison_note: "这次更偏向这款。",
      usage: "取适量轻拍至吸收。",
    }] }) };
    await expect(createTodayUserNarrativeService(upgradedReason).narrate(lightweight)).resolves.toBeNull();
  });

  it("hides a lightweight comparison when no usable alternative facts exist", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚以基础清洁为主。",
      comparison_note: "这次先用这款。",
      usage: "取适量起泡后轻柔洗净即可。",
    }] }) };
    const noDifference = { ...input, steps: [{ ...input.steps[0]!, selectionRationale: {
      ...input.steps[0]!.selectionRationale!,
      comparisonMode: "lightweight_contextual" as const,
      comparableProducts: [],
    } }] };

    await expect(createTodayUserNarrativeService(provider).narrate(noDifference)).resolves.toEqual({
      entries: [expect.objectContaining({ comparison_note: null })],
    });
  });

  it("keeps a contextual preference with the validated owned-product name", async () => {
    const contextual = { ...input, steps: [{ ...input.steps[0]!, selectionRationale: {
      ...input.steps[0]!.selectionRationale!,
      comparisonMode: "lightweight_contextual" as const,
      comparableProducts: [
        {
          ownedProductId: "10000000-0000-4000-8000-000000000002",
          productName: "芙清洁面",
          productFacts: {
            productType: "洁面",
            capabilities: ["清洁"], claims: ["清洁肌肤"], texture: ["凝露质地"],
            usage: [], cautions: [], consumerIngredients: [], ingredientKnowledge: [],
          },
        },
      ],
    } }] };
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚先完成基础清洁，并兼顾容易偏干的位置。",
      comparison_note: "芙清洁面的资料更偏向日常面部清洁；POLA · 黑 BA 洁面奶有明确的泡沫与洗后水润感，所以今天更偏向 POLA。",
      usage: "取适量起泡后轻柔洗净即可。",
    }] }) };

    await expect(createTodayUserNarrativeService(provider).narrate(contextual)).resolves.toMatchObject({
      entries: [{ comparison_note: expect.stringContaining("芙清洁面") }],
    });
    const result = await createTodayUserNarrativeService(provider).narrate(contextual);
    expect(result?.entries[0]?.comparison_note).not.toMatch(/不是同角色|不代表另一款不适合|两者侧重不同/u);
  });

  it("keeps a value-first lightweight comparison when the alternative has only real cleansing usage", async () => {
    const contextual = { ...input, steps: [{ ...input.steps[0]!, selectionRationale: {
      ...input.steps[0]!.selectionRationale!,
      comparisonMode: "lightweight_contextual" as const,
      comparableProducts: [{
        ownedProductId: "10000000-0000-4000-8000-000000000002",
        productName: "至本舒颜修护洁面乳",
        productFacts: {
          productType: "洁面",
          capabilities: [], claims: [], texture: [],
          usage: ["用于日常面部清洁"], cautions: [], consumerIngredients: [], ingredientKnowledge: [],
        },
      }],
    } }] };
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚先完成基础清洁，POLA · 黑 BA 洁面奶可起泡，洗后不紧绷的描述也适合兼顾容易偏干的位置。",
      comparison_note: "至本舒颜修护洁面乳也可用于日常面部清洁；POLA · 黑 BA 洁面奶的泡沫和洗后不紧绷特点更贴近今晚的安排，所以这次先用 POLA。",
      usage: "取适量起泡后轻柔洗净即可。",
    }] }) };

    const result = await createTodayUserNarrativeService(provider).narrate(contextual);

    expect(result?.entries[0]?.comparison_note).toContain("至本舒颜修护洁面乳");
    expect(result?.entries[0]?.comparison_note).toContain("泡沫");
    expect(result?.entries[0]?.comparison_note).toContain("泡沫");
    expect(result?.entries[0]?.comparison_note).not.toMatch(/信息更完整|资料更充分|资料不足|可靠性|证据|research|confidence/u);
  });

  it("allows a strong contextual preference but rejects absolute comparison language", async () => {
    const strong = { ...input, steps: [{ ...input.steps[0]!, selectionRationale: {
      ...input.steps[0]!.selectionRationale!,
      comparisonMode: "strong" as const,
    } }] };
    const safeProvider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚以基础清洁为主。",
      comparison_note: "相比另一瓶，这次更偏向这款，更符合今天不过度清洁的需要。",
      usage: "取适量起泡后轻柔洗净即可。",
    }] }) };
    await expect(createTodayUserNarrativeService(safeProvider).narrate(strong)).resolves.not.toBeNull();

    const absoluteProvider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚以基础清洁为主。",
      comparison_note: "这款更适配今天，也优于另一瓶。",
      usage: "取适量起泡后轻柔洗净即可。",
    }] }) };
    await expect(createTodayUserNarrativeService(absoluteProvider).narrate(strong)).resolves.toBeNull();
  });

  it("replaces low-knowledge type-backed narration with a conservative baseline explanation", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "这瓶的质地更轻薄，配方更适合今天。",
      comparison_note: null,
      usage: "取适量加水起泡后轻柔洗净即可。",
    }] }) };
    const baseline = { ...input, steps: [{
      ...input.steps[0]!,
      baselineTypeBackedPurpose: true,
      selectionRationale: null,
      productFacts: { productType: "洁面", capabilities: [], claims: [], texture: [], usage: [], cautions: [], consumerIngredients: [] },
    }] };
    await expect(createTodayUserNarrativeService(provider).narrate(baseline)).resolves.toEqual({
      entries: [expect.objectContaining({
        reason: "今天需要完成基础清洁，这瓶是你已有的洁面产品，可以承担这一步。",
        comparison_note: null,
      })],
    });
  });

  it("keeps a concrete rationale for a baseline-eligible product when this selection has one", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚先完成温和清洁，洗后不紧绷的使用感也更适合兼顾容易偏干的位置。",
      comparison_note: null,
      usage: "取适量加水起泡后轻柔洗净即可。",
    }] }) };
    const evidenceBackedBaseline = {
      ...input,
      steps: [{
        ...input.steps[0]!,
        baselineTypeBackedPurpose: true,
        selectionRationale: {
          ...input.steps[0]!.selectionRationale!,
          comparisonMode: null,
        },
      }],
    };

    await expect(createTodayUserNarrativeService(provider).narrate(evidenceBackedBaseline)).resolves.toEqual({
      entries: [expect.objectContaining({
        reason: "今晚先完成温和清洁，洗后不紧绷的使用感也更适合兼顾容易偏干的位置。",
        comparison_note: null,
      })],
    });
  });

  it("does not create a comparison note when validator supplied no comparison mode", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚先完成温和清洁。",
      comparison_note: null,
      usage: "取适量加水起泡后轻柔洗净即可。",
    }] }) };
    const droppedComparison = {
      ...input,
      steps: [{ ...input.steps[0]!, selectionRationale: {
        ...input.steps[0]!.selectionRationale!,
        comparisonMode: null,
      } }],
    };

    await expect(createTodayUserNarrativeService(provider).narrate(droppedComparison)).resolves.not.toBeNull();
  });

  it("does not duplicate the product referent while neutralizing candidate language", async () => {
    const provider = { narrate: vi.fn().mockResolvedValue({ entries: [{
      ownedProductId: input.steps[0]!.ownedProductId,
      reason: "今晚先完成温和清洁。",
      comparison_note: "另一款候选产品也可以，但今晚先用这一款。",
      usage: "取适量加水起泡后轻柔洗净即可。",
    }] }) };

    const result = await createTodayUserNarrativeService(provider).narrate(input);
    expect(result?.entries[0]?.comparison_note).toContain("另一件产品");
    expect(result?.entries[0]?.comparison_note).not.toContain("另一款另一件产品");
  });
});
