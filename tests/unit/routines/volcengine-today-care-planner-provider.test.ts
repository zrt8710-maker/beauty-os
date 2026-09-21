import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { carePlannerDecisionSchema, type CarePlannerInput, validateCarePlannerDecisionDetailed } from "@/server/services/today-care-planner-service";
import { createVolcengineTodayCarePlannerProvider } from "@/server/services/volcengine-today-care-planner-provider";

describe("Volcengine Today Care Planner provider", () => {
  beforeEach(() => {
    vi.stubEnv("TODAY_CARE_PLANNER_OUTPUT_CONTRACT", "full");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serializes one provenance-explicit compact context instead of duplicated skin views", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }),
    );
    const provider = createVolcengineTodayCarePlannerProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://planner.example.test/v1",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const input = {
      period: "am",
      routineRolePreferences: [{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid", preferenceRef: "routine_role:am:cleanser" }],
      softPersonalization: { texturePreferences: ["lightweight"], skinGoals: ["hydration", "dark_spots"] },
      effectiveSkinState: [{ duplicate: true }],
      dailyDelta: [{ duplicate: true }],
      longTermBaseline: [{ duplicate: true }],
      todayConfirmed: [{ duplicate: true }],
      manualOverrides: [],
      todaySkin: { duplicate: true },
      longTermContext: { skinType: "oily" },
      skinSignals: [{
        signalId: "skin:baseline_inherited:oiliness:t_zone",
        concern: "oiliness",
        area: "t_zone",
        status: "present",
        grade: null,
        source: "baseline_inherited",
        comparison: null,
      }],
      weather: { temperature: 28, humidity: 68, uvIndex: 7.6, weatherCode: "3", source: "today_weather_context", signals: [{ signalId: "weather:uv_index", metric: "uv_index", value: 7.6 }] },
      eligibleProducts: [], careGuidance: [], recentHistory: [], purposeContext: { hasOilinessContext: true, hasDrynessOrFlakingContext: false }, hardRestrictions: [], unknowns: [], baselineRoles: ["sunscreen"], dailyPriorities: ["sun_protection"], maxSteps: 4,
    } as CarePlannerInput;

    await provider.plan(input);

    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const providerInput = JSON.parse(request.input[0].content[0].text);
    expect(providerInput.skinContext.signals).toEqual(input.skinSignals);
    expect(providerInput.weatherContext.source).toBe("today_weather_context");
    expect(providerInput.weatherContext.signals).toEqual(input.weather?.signals);
    expect(providerInput.skinContext.longTermProfile).toEqual(input.longTermContext);
    expect(providerInput.personalMemoryContext).toEqual([]);
    expect(providerInput.profileSoftPreferences).toEqual({ texturePreferences: ["lightweight"], skinGoals: ["hydration", "dark_spots"] });
    expect(providerInput.routineRolePreferences).toEqual([{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid", preferenceRef: "routine_role:am:cleanser" }]);
    expect(request.instructions).toContain("It does not apply to another period or become dislike of any specific product");
    expect(request.instructions).toContain("texturePreferences are soft preferences only");
    expect(request.instructions).toContain("skinGoals are long-term priorities");
    expect(request.instructions).toContain("selection_rationale contains only candidateIds, selectedProductId, relevantDifferences, whySelectedToday, and certainty");
    expect(providerInput).not.toHaveProperty("effectiveSkinState");
    expect(providerInput).not.toHaveProperty("todaySkin");
    expect(request.max_output_tokens).toBe(4000);
    expect(request.text.format.schema.required).not.toEqual(expect.arrayContaining([
      "priority_focus", "optional_steps", "not_recommended", "uncertainties",
    ]));
    expect(request.text.format.schema.properties.selected_steps.items.properties).not.toHaveProperty("role");
    const selectionRationaleSchema = request.text.format.schema.properties.selected_steps.items.properties.selection_rationale;
    expect(selectionRationaleSchema.required).toEqual([
      "candidateIds", "selectedProductId", "relevantDifferences", "whySelectedToday", "certainty",
    ]);
    expect(Object.keys(selectionRationaleSchema.properties)).toEqual(selectionRationaleSchema.required);
    expect(request.instructions).not.toContain("whyAlternativesNotPreferred");
    expect(request.instructions).not.toContain("why alternatives were not preferred");

    const id = "10000000-0000-4000-8000-000000000001";
    expect(carePlannerDecisionSchema.safeParse({
      strategy: "balanced",
      strategy_summary: "今天保持基础护理。",
      selected_steps: [{ ownedProductId: id, purpose: "cleansing", why_today: "完成晚间清洁。", why_this_product: "适合今天的清洁步骤。", evidence_refs: [], selection_rationale: { candidateIds: [id], selectedProductId: id, relevantDifferences: [], whySelectedToday: "今天优先完成基础清洁。", certainty: "clear" } }],
      unresolved_needs: [],
      usedGuidanceIds: [],
      productFitAssessments: { selected: [] },
      candidateComparisons: [],
    }).success).toBe(true);
  });

  it("sends only the supplied PM cleanser preference to the Planner transport", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }),
    );
    const provider = createVolcengineTodayCarePlannerProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://planner.example.test/v1",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const input = {
      ...minimalPlannerInput(),
      period: "pm" as const,
      routineRolePreferences: [{
        scope: "routine_role" as const,
        period: "pm" as const,
        routine_role: "cleanser" as const,
        polarity: "prefer" as const,
        preferenceRef: "routine_role:pm:cleanser",
      }],
    };

    await provider.plan(input);

    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const providerInput = JSON.parse(request.input[0].content[0].text);
    expect(providerInput.period).toBe("pm");
    expect(providerInput.routineRolePreferences).toEqual([{
      scope: "routine_role",
      period: "pm",
      routine_role: "cleanser",
      polarity: "prefer",
      preferenceRef: "routine_role:pm:cleanser",
    }]);
  });

  it("logs payload section sizes without logging provider input content", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }),
    );
    const provider = createVolcengineTodayCarePlannerProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://planner.example.test/v1",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const privateMarker = "PRIVATE_PROFILE_MARKER";

    await provider.plan({
      period: "am",
      softPersonalization: { texturePreferences: [privateMarker], skinGoals: [] },
      personalMemoryContext: [],
      skinSignals: [],
      weather: null,
      effectiveSkinState: [],
      dailyDelta: [],
      longTermBaseline: [],
      todayConfirmed: [],
      manualOverrides: [],
      todaySkin: [],
      longTermContext: {},
      eligibleProducts: [],
      careGuidance: [],
      recentHistory: [],
      purposeContext: { hasOilinessContext: false, hasDrynessOrFlakingContext: false },
      hardRestrictions: [],
      unknowns: [],
      baselineRoles: [],
      dailyPriorities: [],
      maxSteps: 4,
    } as CarePlannerInput);

    const payloadSize = log.mock.calls.find(([scope, details]) =>
      scope === "[today-care-planner]" && details?.stage === "planner_payload_size")?.[1];
    expect(payloadSize).toMatchObject({
      product_count: 0,
      eligible_products_chars: 2,
    });
    for (const field of [
      "instructions_chars", "schema_chars", "skin_context_chars", "profile_chars",
      "weather_chars", "memory_chars", "care_guidance_chars", "total_serialized_chars",
    ]) {
      expect(payloadSize?.[field]).toEqual(expect.any(Number));
    }
    expect(JSON.stringify(payloadSize)).not.toContain(privateMarker);
    log.mockRestore();
  });

  it("uses a 75 second default deadline for Today Planner only", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const provider = createVolcengineTodayCarePlannerProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://planner.example.test/v1",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }),
      ) as typeof fetch,
    });

    await expect(provider.plan(minimalPlannerInput())).resolves.toEqual({});

    expect(timeout).toHaveBeenCalledWith(75_000);
    timeout.mockRestore();
  });

  it("classifies AbortSignal timeout without logging request content", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error("missing signal"));
      const rejectWithReason = () => reject(signal.reason);
      if (signal.aborted) rejectWithReason();
      else signal.addEventListener("abort", rejectWithReason, { once: true });
    }));
    const provider = createVolcengineTodayCarePlannerProvider({
      apiKey: "SECRET_TEST_KEY",
      model: "test-model",
      baseUrl: "https://planner.example.test/v1",
      timeoutMs: 1,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.plan({
      ...minimalPlannerInput(),
      personalMemoryContext: ["PRIVATE_TIMEOUT_MARKER"],
    })).rejects.toMatchObject({ name: "TimeoutError" });

    const failure = log.mock.calls.find(([scope, details]) =>
      scope === "[today-care-planner]" && details?.stage === "provider_request")?.[1];
    expect(failure).toMatchObject({
      status: "network_error",
      error_name: "TimeoutError",
      cause_code: null,
      failure_kind: "abort_timeout",
      duration_ms: expect.any(Number),
    });
    expect(JSON.stringify(failure)).not.toContain("SECRET_TEST_KEY");
    expect(JSON.stringify(failure)).not.toContain("PRIVATE_TIMEOUT_MARKER");
    log.mockRestore();
  });

  it.each([
    ["UND_ERR_CONNECT_TIMEOUT", "connect_timeout"],
    ["ENOTFOUND", "dns/network"],
    ["ECONNRESET", "connection_reset"],
    ["UND_ERR_UNKNOWN", "other_transport"],
  ] as const)("classifies transport cause %s as %s", async (causeCode, failureKind) => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider = createVolcengineTodayCarePlannerProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://planner.example.test/v1",
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed", {
        cause: { code: causeCode },
      })) as typeof fetch,
    });

    await expect(provider.plan(minimalPlannerInput())).rejects.toThrow("fetch failed");

    const failure = log.mock.calls.find(([scope, details]) =>
      scope === "[today-care-planner]" && details?.stage === "provider_request")?.[1];
    expect(failure).toMatchObject({
      status: "network_error",
      error_name: "TypeError",
      cause_code: causeCode,
      failure_kind: failureKind,
      duration_ms: expect.any(Number),
    });
    log.mockRestore();
  });

  it("requires every returned product reference to be a complete eligible owned-product UUID", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });

    await provider.plan({ period: "pm", softPersonalization: { texturePreferences: [], skinGoals: [] }, personalMemoryContext: [], skinSignals: [], weather: null, effectiveSkinState: [], dailyDelta: [], longTermBaseline: [], todayConfirmed: [], manualOverrides: [], todaySkin: [], longTermContext: {}, eligibleProducts: [], careGuidance: [], recentHistory: [], purposeContext: { hasOilinessContext: false, hasDrynessOrFlakingContext: false }, hardRestrictions: [], unknowns: [], baselineRoles: [], dailyPriorities: [], maxSteps: 4 } as CarePlannerInput);

    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const schema = request.text.format.schema;
    const uuidPattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
    expect(request.instructions).toContain("copy a complete UUID verbatim from eligibleProducts[].ownedProductId");
    expect(request.instructions).toContain("Never use a product name, alias, catalog_product_id");
    expect(schema.properties.selected_steps.items.properties.ownedProductId.pattern).toBe(uuidPattern);
    expect(schema.properties.selected_steps.items.properties.selection_rationale.properties.candidateIds.items.pattern).toBe(uuidPattern);
    expect(schema.properties.selected_steps.items.properties.selection_rationale.properties.selectedProductId.pattern).toBe(uuidPattern);
    expect(schema.properties.productFitAssessments.properties.selected.items.properties.ownedProductId.pattern).toBe(uuidPattern);
    expect(schema.properties.candidateComparisons.items.properties.candidateIds.items.pattern).toBe(uuidPattern);
    expect(schema.properties.candidateComparisons.items.properties.selectedProductIds.items.pattern).toBe(uuidPattern);
  });

  it("concatenates all Responses output_text segments in order and ignores other content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ status: "completed", content: [
        { type: "reasoning", text: "must not be extracted" },
        { type: "output_text", text: "{\"repaired\":" },
        { type: "input_text", text: "must not be extracted" },
        { type: "output_text", text: "true}" },
      ] }],
    }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({
      apiKey: "test-key",
      model: "test-model",
      baseUrl: "https://planner.example.test/v1",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.plan(minimalPlannerInput())).resolves.toEqual({ repaired: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not ask another model to complete a JSON string interrupted mid-value", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{\"strategy\":\"bal" }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });

    await expect(provider.plan(minimalPlannerInput())).rejects.toThrow("CARE_PLANNER_MALFORMED_OUTPUT");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("closes only an otherwise complete JSON structure without another provider request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{\"repaired\":true" }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });

    await expect(provider.plan(minimalPlannerInput())).resolves.toEqual({ repaired: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("logs response metadata without output text", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      incomplete_details: { reason: "length" },
      error: { code: "none" },
      output: [{ status: "completed", content: [{ type: "output_text", text: "{\"privateOutput\":true}" }] }],
    }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });

    await expect(provider.plan(minimalPlannerInput())).resolves.toEqual({ privateOutput: true });
    const metadata = log.mock.calls.find(([scope, details]) => scope === "[today-care-planner]" && details?.stage === "provider_response_metadata")?.[1];
    expect(metadata).toMatchObject({
      extractionPath: "concatenated_segments",
      outputTextSegmentCount: 1,
      outputTextSegmentCharLengths: [22],
      responseStatus: "completed",
      outputItemStatuses: ["completed"],
      incompleteReason: "length",
      errorCode: "none",
    });
    expect(JSON.stringify(metadata)).not.toContain("privateOutput");
    log.mockRestore();
    vi.unstubAllEnvs();
  });

  it("deduplicates provider-only product aliases while preserving hard and advisory ingredient evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });
    const input = {
      period: "pm", softPersonalization: { texturePreferences: [], skinGoals: [] }, skinSignals: [], weather: null, effectiveSkinState: [], dailyDelta: [], longTermBaseline: [], todayConfirmed: [], manualOverrides: [], todaySkin: [], longTermContext: {}, recentHistory: [], purposeContext: { hasOilinessContext: true, hasDrynessOrFlakingContext: true }, careGuidance: [], hardRestrictions: [], unknowns: [], baselineRoles: [], dailyPriorities: [], maxSteps: 4,
      eligibleProducts: [{
        ownedProductId: "10000000-0000-4000-8000-000000000001", displayName: "POLA · 黑 BA 洁面奶", productType: "cleanser", inventory: { quantityPercent: 80 }, knownFacts: ["ingredients"], unknownFields: [], limitations: [], supportedPurposes: ["cleansing"], usageHistory: { usageCount: 3, averageRating: 5, positiveSignals: ["多次体验较稳定"], preferenceIssues: [], highReactionCount: 0, recentRelevantFeedbackSummary: "近几次体验较稳定" },
        productEvidence: {
          productType: "cleanser",
          claims: [{ text: "清洁面部", evidenceRefs: ["claim-source"] }],
          usage: null,
          texture: null,
          ingredients: [
            { normalizedName: "Glycerin", evidenceRefs: ["hard-glycerin"] },
            { normalizedName: "Niacinamide", evidenceRefs: ["hard-niacinamide"] },
            { normalizedName: "Panthenol", evidenceRefs: ["panthenol-source"] },
          ],
          advisoryIngredients: [
            { name: "Niacinamide", evidenceRefs: ["advisory-niacinamide"] },
            { name: "Panthenol", evidenceRefs: ["panthenol-source"] },
            { name: "Decyl Glucoside", evidenceRefs: ["advisory-decyl"] },
          ],
          ingredientKnowledge: [{ canonicalName: "niacinamide", displayNameZh: "烟酰胺", functions: ["skin conditioning"], statementZh: "可用于配方调理。", boundaries: ["不能单独证明产品功效。"] }],
          sourceRefs: [{ id: "source-1", sourceType: "official_brand", title: "Official" }],
          supportedPurposes: ["cleansing"],
          evidenceRefs: ["claim-source", "hard-glycerin", "hard-niacinamide", "advisory-niacinamide", "panthenol-source", "advisory-decyl"],
          usableSkincareEvidence: true,
          provenance: "draft_derived",
          knownFacts: ["ingredients"],
          unknownFields: ["texture", "usage", "cautions"],
          limitations: ["texture_unknown", "usage_unknown", "cautions_unknown"],
        },
      }],
    } as CarePlannerInput;
    const internalInputBeforeProviderProjection = structuredClone(input);

    await provider.plan(input);

    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const serialized = JSON.parse(request.input[0].content[0].text);
    expect(serialized.eligibleProducts[0].productEvidence.ingredients).toEqual([
      { name: "Glycerin", applicability: "hard", evidenceRefs: ["hard-glycerin"] },
      {
        name: "Niacinamide",
        applicability: "both",
        hardEvidenceRefs: ["hard-niacinamide"],
        advisoryEvidenceRefs: ["advisory-niacinamide"],
      },
      { name: "Panthenol", applicability: "both", evidenceRefs: ["panthenol-source"] },
      { name: "Decyl Glucoside", applicability: "advisory", evidenceRefs: ["advisory-decyl"] },
    ]);
    expect(serialized.eligibleProducts[0]).toMatchObject({
      productType: "cleanser",
      supportedPurposes: ["cleansing"],
    });
    expect(serialized.eligibleProducts[0]).not.toHaveProperty("knownFacts");
    expect(serialized.eligibleProducts[0]).not.toHaveProperty("unknownFields");
    expect(serialized.eligibleProducts[0]).not.toHaveProperty("limitations");
    expect(serialized.eligibleProducts[0].productEvidence).toMatchObject({
      claims: [{ text: "清洁面部", evidenceRefs: ["claim-source"] }],
      unknownFields: ["texture", "usage", "cautions"],
      provenance: "draft_derived",
      evidenceRefs: ["claim-source", "hard-glycerin", "hard-niacinamide", "advisory-niacinamide", "panthenol-source", "advisory-decyl"],
    });
    expect(serialized.eligibleProducts[0].productEvidence).not.toHaveProperty("advisoryIngredients");
    expect(serialized.eligibleProducts[0].productEvidence).not.toHaveProperty("productType");
    expect(serialized.eligibleProducts[0].productEvidence).not.toHaveProperty("supportedPurposes");
    expect(serialized.eligibleProducts[0].productEvidence).not.toHaveProperty("sourceRefs");
    expect(serialized.eligibleProducts[0].productEvidence).not.toHaveProperty("knownFacts");
    expect(serialized.eligibleProducts[0].productEvidence).not.toHaveProperty("limitations");
    expect(serialized.eligibleProducts[0].productEvidence).not.toHaveProperty("usableSkincareEvidence");
    expect(serialized.eligibleProducts[0].productEvidence.ingredientKnowledge).toEqual(input.eligibleProducts[0]!.productEvidence.ingredientKnowledge);
    expect(serialized.eligibleProducts[0].usageHistory).toEqual({
      usageCount: 3,
      averageRating: 5,
      positiveSignals: ["多次体验较稳定"],
      preferenceIssues: [],
      highReactionCount: 0,
      recentRelevantFeedbackSummary: "近几次体验较稳定",
    });
    expect(input).toEqual(internalInputBeforeProviderProjection);

    const id = input.eligibleProducts[0]!.ownedProductId;
    const decision = carePlannerDecisionSchema.parse({
      strategy: "balanced",
      strategy_summary: "完成基础清洁。",
      selected_steps: [{
        ownedProductId: id,
        purpose: "cleansing",
        why_today: "完成晚间清洁。",
        why_this_product: "这瓶可以完成清洁。",
        evidence_refs: ["claim-source"],
        selection_rationale: {
          candidateIds: [id],
          selectedProductId: id,
          relevantDifferences: [],
          whySelectedToday: "这瓶可以完成清洁。",
          certainty: "clear",
        },
      }],
      unresolved_needs: [],
      usedGuidanceIds: [],
      productFitAssessments: {
        selected: [{
          ownedProductId: id,
          relevantSkinSignals: [],
          supportedPurposes: ["cleansing"],
          relevantEvidenceRefs: ["claim-source"],
          relevantWeatherSignals: [],
          fitSummary: "这瓶可以完成清洁。",
          fitLevel: "reasonable",
        }],
        topAlternatives: [],
      },
      candidateComparisons: [],
    });
    const validationInput = {
      decision,
      careGuidanceIds: [],
      hardRestrictions: [],
      maxSteps: 4,
      skinSignals: [],
      weatherSignals: [],
      period: "pm" as const,
    };
    expect(validateCarePlannerDecisionDetailed({
      ...validationInput,
      candidates: input.eligibleProducts,
    })).toEqual(validateCarePlannerDecisionDetailed({
      ...validationInput,
      candidates: internalInputBeforeProviderProjection.eligibleProducts,
    }));
  });

  it("passes private long-term memory only as soft planner context", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });
    await provider.plan({ period: "pm", softPersonalization: { texturePreferences: [], skinGoals: [] }, personalMemoryContext: ["过去偏好轻薄、不黏，且希望步骤简单。"], skinSignals: [], weather: null, effectiveSkinState: [], dailyDelta: [], longTermBaseline: [], todayConfirmed: [], manualOverrides: [], todaySkin: [], longTermContext: {}, eligibleProducts: [], careGuidance: [], recentHistory: [], purposeContext: { hasOilinessContext: false, hasDrynessOrFlakingContext: false }, hardRestrictions: [], unknowns: [], baselineRoles: [], dailyPriorities: [], maxSteps: 4 } as CarePlannerInput);
    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const serialized = JSON.parse(request.input[0].content[0].text);
    expect(serialized.personalMemoryContext).toEqual(["过去偏好轻薄、不黏，且希望步骤简单。"]);
    expect(request.instructions).toContain("soft only");
  });

  it("keeps empty Profile soft preferences explicit without inventing product facts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });
    await provider.plan({ period: "pm", softPersonalization: { texturePreferences: [], skinGoals: [] }, skinSignals: [], weather: null, effectiveSkinState: [], dailyDelta: [], longTermBaseline: [], todayConfirmed: [], manualOverrides: [], todaySkin: [], longTermContext: {}, eligibleProducts: [], careGuidance: [], recentHistory: [], purposeContext: { hasOilinessContext: false, hasDrynessOrFlakingContext: false }, hardRestrictions: [], unknowns: [], baselineRoles: [], dailyPriorities: [], maxSteps: 4 } as CarePlannerInput);

    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const serialized = JSON.parse(request.input[0].content[0].text);
    expect(serialized.profileSoftPreferences).toEqual({ texturePreferences: [], skinGoals: [] });
    expect(serialized.eligibleProducts).toEqual([]);
  });

  it("separates today's blemish signals from a baseline-only acne tendency", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });
    const input = {
      period: "pm", softPersonalization: { texturePreferences: [], skinGoals: [] }, effectiveSkinState: [], dailyDelta: [], longTermBaseline: [], todayConfirmed: [], manualOverrides: [], todaySkin: [], longTermContext: {}, weather: null, eligibleProducts: [], careGuidance: [], recentHistory: [], purposeContext: { hasOilinessContext: false, hasDrynessOrFlakingContext: false }, hardRestrictions: [], unknowns: [], baselineRoles: [], dailyPriorities: [], maxSteps: 4,
      skinSignals: [
        { signalId: "skin:baseline_inherited:blemishes:chin", concern: "blemishes", area: "chin", status: "present", grade: 1, source: "baseline_inherited", comparison: null },
        { signalId: "skin:today_confirmed:small_bumps:forehead", concern: "small_bumps", area: "forehead", status: "present", grade: 2, source: "today_confirmed", comparison: "more_than_usual" },
      ],
    } as CarePlannerInput;

    await provider.plan(input);

    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const serialized = JSON.parse(request.input[0].content[0].text);
    expect(serialized.skinContext.todayTargetedCareSignals).toEqual([input.skinSignals[1]]);
  });

  it("uses the Production-Minimal schema by default and deterministically restores validator fields", async () => {
    vi.stubEnv("TODAY_CARE_PLANNER_OUTPUT_CONTRACT", "");
    const id = "10000000-0000-4000-8000-000000000001";
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        strategy: "balanced",
        strategy_summary: "今天保持基础护理。",
        selected_steps: [{
          ownedProductId: id,
          purpose: "cleansing",
          why_today: "完成晚间基础清洁。",
          whySelectedToday: "这瓶可承担今天的基础清洁。",
          evidence_refs: ["source-1"],
          relevantSkinSignalIds: ["skin-1"],
          relevantWeatherSignalIds: [],
          selection_rationale: { candidateIds: [id], relevantDifferences: [], certainty: "clear" },
        }],
        unresolved_needs: [],
        candidateComparisons: [],
        notNeededPurposes: [],
      }),
    }), { status: 200 }));
    const provider = createVolcengineTodayCarePlannerProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://planner.example.test/v1", fetchImpl: fetchImpl as typeof fetch });

    const decision = await provider.plan(minimalPlannerInput());
    const request = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    const schema = request.text.format.schema;

    expect(schema.properties.selected_steps.items.properties).not.toHaveProperty("why_this_product");
    expect(schema.properties.selected_steps.items.properties).not.toHaveProperty("value_if_removed");
    expect(schema.properties).not.toHaveProperty("productFitAssessments");
    expect(schema.properties).not.toHaveProperty("usedGuidanceIds");
    expect(schema.properties).not.toHaveProperty("purposeOmissions");
    expect(schema.required).toContain("notNeededPurposes");
    expect(schema.properties.notNeededPurposes.items.enum).toEqual([
      "cleansing",
      "basic_moisturization",
      "hydration_support",
      "sun_protection",
      "optional_treatment",
    ]);
    expect(decision.selected_steps[0]).toMatchObject({
      why_this_product: "这瓶可承担今天的基础清洁。",
      selection_rationale: { selectedProductId: id, whySelectedToday: "这瓶可承担今天的基础清洁。" },
    });
    expect(decision.productFitAssessments.selected[0]).toMatchObject({
      ownedProductId: id,
      relevantSkinSignals: ["skin-1"],
      relevantEvidenceRefs: ["source-1"],
      fitSummary: "这瓶可承担今天的基础清洁。",
      fitLevel: "reasonable",
    });
  });
});

function minimalPlannerInput(): CarePlannerInput {
  return {
    period: "pm",
    softPersonalization: { texturePreferences: [], skinGoals: [] },
    personalMemoryContext: [],
    skinSignals: [],
    weather: null,
    effectiveSkinState: [],
    dailyDelta: [],
    longTermBaseline: [],
    todayConfirmed: [],
    manualOverrides: [],
    todaySkin: [],
    longTermContext: {},
    eligibleProducts: [],
    careGuidance: [],
    recentHistory: [],
    purposeContext: { hasOilinessContext: false, hasDrynessOrFlakingContext: false },
    hardRestrictions: [],
    unknowns: [],
    baselineRoles: [],
    dailyPriorities: [],
    maxSteps: 4,
  };
}
