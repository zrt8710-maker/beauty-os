import "server-only";

import { z } from "zod";

import { PRODUCT_TYPES } from "@/schemas/product";
import {
  AGENT3_RESEARCH_SOURCE_TYPES,
  productResearchInputSchema,
  agent3ResearchResultSchema,
  isolateAgent3ResearchSections,
  type ProductResearchInput,
  type Agent3ResearchResult,
} from "@/schemas/product-research";
import {
  createDevelopmentAgent3RawDiagnosticCapture,
  type Agent3ConfidenceDiagnostic,
  type Agent3RawDiagnosticCapture,
} from "@/server/product-research/agent3-raw-diagnostic";
import {
  classifyProductSearchResults,
  classifySourcePriority,
  type ClassifiedProductSearchResult,
} from "@/server/product-search/product-search-source-classifier";

const diagnosticIds = new WeakMap<object, string>();

export function getAgent3DiagnosticId(result: Agent3ResearchResult) {
  return diagnosticIds.get(result) ?? null;
}

export class ProductResearchUnavailableError extends Error {
  readonly code = "PRODUCT_RESEARCH_UNAVAILABLE";
  constructor(readonly failureKind: ProductResearchFailureKind, message = "PRODUCT_RESEARCH_UNAVAILABLE", readonly diagnosticId: string | null = null) { super(message); this.name = "ProductResearchUnavailableError"; }
}
export type ProductResearchFailureKind = "provider_not_configured" | "http_error" | "first_event_timeout" | "overall_timeout" | "stream_error" | "stream_closed_early" | "empty_output" | "json_parse_error" | "schema_error" | "source_reference_error" | "unknown_provider_error";

export type ProductResearchProvider = {
  providerCode: "volcengine_agent_plan";
  research(input: ProductResearchInput): Promise<Agent3ResearchResult>;
};

type ProviderOptions = {
  apiKey: string; model: string; baseUrl: string; fetchImpl?: typeof fetch;
  firstEventTimeoutMs?: number; overallTimeoutMs?: number;
  diagnostics?: Agent3RawDiagnosticCapture;
};
const FIRST_EVENT_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 120_000;

export function createVolcengineAgentPlanProductResearchProvider(options: ProviderOptions): ProductResearchProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const overallTimeoutMs = options.overallTimeoutMs ?? OVERALL_TIMEOUT_MS;
  const firstEventTimeoutMs = Math.min(options.firstEventTimeoutMs ?? FIRST_EVENT_TIMEOUT_MS, overallTimeoutMs);
  const diagnostics = options.diagnostics;
  return {
    providerCode: "volcengine_agent_plan",
    async research(rawInput) {
      const startedAt = Date.now();
      const input = productResearchInputSchema.parse(rawInput);
      const controller = new AbortController();
      let timeoutKind: ProductResearchFailureKind | null = null;
      const firstEventTimer = setTimeout(() => { timeoutKind = "first_event_timeout"; controller.abort(); }, firstEventTimeoutMs);
      const overallTimer = setTimeout(() => { timeoutKind = "overall_timeout"; controller.abort(); }, overallTimeoutMs);
      try {
        const response = await awaitWithAbort(fetchImpl(options.baseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
          signal: controller.signal,
          body: JSON.stringify({
            model: options.model,
            input: `${productResearchPrompt}\n${sourceGuardPrompt(input)}\nINPUT:${JSON.stringify(modelFacingResearchInput(input))}`,
            tools: [{ type: "web_search", web_search: {} }],
            stream: true,
            thinking: { type: "disabled" },
          }),
        }), controller.signal);
        if (!response.ok || response.body === null) throw new ProductResearchUnavailableError("http_error", `PRODUCT_RESEARCH_HTTP_${response.status}`);
        const streamed = await readStream(response.body, controller.signal, () => clearTimeout(firstEventTimer), () => undefined);
        let json: unknown;
        try { json = JSON.parse(stripFence(streamed.outputText)); } catch {
          const diagnosticId = await recordDiagnostic(diagnostics, input, options.model, startedAt, streamed.researchRunId, streamed.outputText, { json_parse_success: false, schema_success: false, issues: [{ path: "", code: "json_parse_error", message: "Final output is not valid JSON." }] });
          throw new ProductResearchUnavailableError("json_parse_error", "PRODUCT_RESEARCH_UNAVAILABLE", diagnosticId);
        }
        const normalizedTransport = normalizeAgent3Transport(json);
        if (normalizedTransport.stringReasons > 0 || normalizedTransport.malformedReasons > 0
          || normalizedTransport.candidateArraysWrapped > 0 || normalizedTransport.malformedCandidatesDropped > 0
          || normalizedTransport.ingredientsRepresentationsNormalized > 0
          || normalizedTransport.malformedSections.length > 0 || normalizedTransport.sourcesNormalized > 0) {
          researchDebug("provider_transport_normalization", {
            reasons_string_normalized: normalizedTransport.stringReasons,
            reasons_malformed_emptied: normalizedTransport.malformedReasons,
            optional_candidate_arrays_wrapped: normalizedTransport.candidateArraysWrapped,
            optional_candidate_fields_dropped: normalizedTransport.malformedCandidatesDropped,
            ingredients_representations_normalized: normalizedTransport.ingredientsRepresentationsNormalized,
            malformed_sections_isolated: normalizedTransport.malformedSections,
            sources_normalized: normalizedTransport.sourcesNormalized,
          });
        }
        const result = agent3ResearchResultSchema.safeParse(normalizedTransport.value);
        if (!result.success) {
          researchDebug("provider_result_validation", { schema_success: false, issues: result.error.issues.slice(0, 5).map((x) => ({ path: x.path.join("."), code: x.code, message: x.message })) });
          const diagnosticId = await recordDiagnostic(diagnostics, input, options.model, startedAt, runIdFromJson(json) ?? streamed.researchRunId, streamed.outputText, { json_parse_success: true, schema_success: false, issues: result.error.issues.slice(0, 20).map((x) => ({ path: x.path.join("."), code: x.code, message: x.message })) });
          throw new ProductResearchUnavailableError("schema_error", "PRODUCT_RESEARCH_UNAVAILABLE", diagnosticId);
        }
        const guarded = applySourceGuard(input, result.data);
        const output = { ...guarded.result, research_run_id: guarded.result.research_run_id ?? streamed.researchRunId };
        researchDebug("source_confidence", guarded.confidenceDiagnostic);
        const diagnosticId = await recordDiagnostic(
          diagnostics,
          input,
          options.model,
          startedAt,
          output.research_run_id,
          streamed.outputText,
          { json_parse_success: true, schema_success: true, issues: [] },
          guarded.confidenceDiagnostic,
        );
        if (diagnosticId) diagnosticIds.set(output, diagnosticId);
        return output;
      } catch (error) {
        if (error instanceof ProductResearchUnavailableError) {
          if (!error.diagnosticId) {
            const diagnosticId = await recordDiagnostic(diagnostics, input, options.model, startedAt, null, null, { json_parse_success: false, schema_success: false, issues: [{ path: "", code: error.failureKind, message: error.message }] });
            throw new ProductResearchUnavailableError(error.failureKind, error.message, diagnosticId);
          }
          throw error;
        }
        if (error instanceof z.ZodError) throw new ProductResearchUnavailableError("source_reference_error");
        throw new ProductResearchUnavailableError(timeoutKind ?? "unknown_provider_error", controller.signal.aborted ? "PRODUCT_RESEARCH_TIMEOUT" : undefined);
      } finally {
        clearTimeout(firstEventTimer);
        clearTimeout(overallTimer);
      }
    },
  };
}

async function readStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onFirstEvent: () => void, onFirstOutput: () => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", outputText = "", researchRunId: string | null = null, gotEvent = false, gotOutput = false, completed = false;
  while (!completed) {
    const result = await awaitWithAbort(reader.read(), signal);
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const event = parseEvent(buffer.slice(0, boundary).replace(/\r/g, ""));
      buffer = buffer.slice(boundary + 2);
      if (!event) continue;
      if (!gotEvent) { gotEvent = true; onFirstEvent(); }
      if (event.type === "response.created") researchRunId = responseId(event) ?? researchRunId;
      if (event.type === "response.output_text.delta") {
        if (typeof event.delta !== "string") throw new Error("MALFORMED_OUTPUT_TEXT_DELTA");
        outputText += event.delta;
        if (!gotOutput) { gotOutput = true; onFirstOutput(); }
      }
      if (event.type === "response.completed") completed = true;
    }
  }
  if (!gotEvent || !completed) throw new ProductResearchUnavailableError("stream_closed_early");
  if (!outputText.trim()) throw new ProductResearchUnavailableError("empty_output");
  return { outputText, researchRunId };
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("STREAM_ABORTED");
  return Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("STREAM_ABORTED")), { once: true }))]);
}
function parseEvent(frame: string): Record<string, unknown> | null {
  const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!data || data === "[DONE]") return null;
  const event: unknown = JSON.parse(data);
  if (typeof event !== "object" || event === null || Array.isArray(event) || typeof (event as { type?: unknown }).type !== "string") throw new Error("MALFORMED_SSE_EVENT");
  return event as Record<string, unknown>;
}
function responseId(event: Record<string, unknown>) {
  const response = event.response;
  return typeof response === "object" && response !== null && typeof (response as { id?: unknown }).id === "string" ? (response as { id: string }).id : null;
}
function stripFence(value: string) { return value.trim().replace(/^\`\`\`json\s*|\s*\`\`\`$/gi, ""); }
function researchDebug(stage: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.info("AGENT3_RESEARCH_DEBUG", { stage, ...payload });
}

function modelFacingResearchInput(input: ProductResearchInput) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "barcode"));
}

function sourceGuardPrompt(input: ProductResearchInput) {
  const classifications = classifyProductSearchResults(input, input.search_results ?? []);
  if (!classifications.length) return "SEARCH_SOURCE_GUARD: No application-provided search leads are available.";
  return `SEARCH_SOURCE_GUARD: Each application-provided URL has a deterministic match class. A URL classified wrong_variant or wrong_product_line is diagnostic-only: it MUST NOT support identity, ingredients, claims, product_type, texture, or usage. exact_variant_uncertain can support only cautious provisional facts and MUST NOT establish exact formula or version certainty.\n${classifications.map((item) => `- ${item.url} | class=${item.source_class} | priority=${item.source_priority}`).join("\n")}`;
}

const evidenceBlockNames = ["identity", "ingredients", "claims", "texture", "usage", "product_type"] as const;
const hypothesisBlockNames = ["care_role_candidates", "capability_candidates"] as const;
const blockedSourceClasses = new Set(["wrong_variant", "wrong_product_line"]);

function applySourceGuard(input: ProductResearchInput, result: Agent3ResearchResult) {
  const classifications = classifyProductSearchResults(input, input.search_results ?? []);
  const classificationByUrl = new Map(classifications.map((item) => [normalizeSourceUrl(item.url), item]));
  const knownSourceIds = new Set(result.sources.map((source) => source.source_id));
  const blockedSourceIds = new Set(result.sources.flatMap((source) => {
    const classified = classificationByUrl.get(normalizeSourceUrl(source.url ?? source.URL ?? ""));
    return classified && blockedSourceClasses.has(classified.source_class) ? [source.source_id] : [];
  }));
  for (const name of [...evidenceBlockNames, ...hypothesisBlockNames]) {
    const section = result.research_payload[name];
    if (!section) continue;
    for (const reference of section.evidence_refs) if (!knownSourceIds.has(reference)) blockedSourceIds.add(reference);
    if (Array.isArray(section.value)) {
      for (const fact of section.value) {
        if (!isPlainRecord(fact) || !Array.isArray(fact.evidence_refs)) continue;
        for (const reference of fact.evidence_refs) if (typeof reference === "string" && !knownSourceIds.has(reference)) blockedSourceIds.add(reference);
      }
    } else if (name === "ingredients" && isPlainRecord(section.value)) {
      const ingredientItems = (section.value as Record<string, unknown>).items;
      if (!Array.isArray(ingredientItems)) continue;
      for (const fact of ingredientItems) {
        if (!isPlainRecord(fact) || !Array.isArray(fact.evidence_refs)) continue;
        for (const reference of fact.evidence_refs) if (typeof reference === "string" && !knownSourceIds.has(reference)) blockedSourceIds.add(reference);
      }
    }
  }
  let blockedEvidenceSectionCount = 0;
  const payload: Record<string, unknown> = { ...result.research_payload };
  for (const name of [...evidenceBlockNames, ...hypothesisBlockNames]) {
    const section = payload[name];
    if (!isResearchEvidenceBlock(section)) continue;
    const sanitized = sanitizeEvidenceBlock(name, section, blockedSourceIds);
    payload[name] = sanitized.section;
    if (sanitized.sectionDropped) blockedEvidenceSectionCount += 1;
  }
  const guarded = agent3ResearchResultSchema.parse({ ...result, research_payload: payload });
  const confidence = applySectionSourceTrust(guarded, classifications, blockedEvidenceSectionCount);
  return {
    result: confidence.result,
    classifications,
    blockedEvidenceSectionCount,
    confidenceDiagnostic: confidence.diagnostic,
  };
}

type ResearchEvidenceBlock = {
  value: unknown;
  evidence_refs: string[];
  confidence: number;
  reasons: string[];
  has_conflict: boolean;
  includes_ai_inference: boolean;
};

function isResearchEvidenceBlock(value: unknown): value is ResearchEvidenceBlock {
  return isPlainRecord(value)
    && Array.isArray(value.evidence_refs)
    && typeof value.confidence === "number"
    && Array.isArray(value.reasons)
    && typeof value.has_conflict === "boolean"
    && typeof value.includes_ai_inference === "boolean"
    && "value" in value;
}

/**
 * Removes unsupported references at the smallest shape the Agent3 transport
 * exposes. List-valued facts keep their own surviving references; scalar and
 * aggregate values use the surviving section references. A bad lead can no
 * longer erase independently supported facts from the same section.
 */
function sanitizeEvidenceBlock(
  name: typeof evidenceBlockNames[number] | typeof hypothesisBlockNames[number],
  section: ResearchEvidenceBlock,
  blockedSourceIds: Set<string>,
): { section: ResearchEvidenceBlock; sectionDropped: boolean } {
  const sectionRefs = section.evidence_refs.filter((reference) => !blockedSourceIds.has(reference));
  const removedSectionRefs = section.evidence_refs.length - sectionRefs.length;
  const originalHasValue = hasResearchValue(name, section.value);
  let value = section.value;
  let factRefs: string[] = [];
  let factsChanged = false;

  if (name === "ingredients" && isPlainRecord(value)) {
    const facts = sanitizeFactArray(value.items, sectionRefs, blockedSourceIds);
    factRefs = facts.evidenceRefs;
    factsChanged = facts.changed;
    const rawText = sectionRefs.length > 0 ? value.raw_text : [];
    const hasRawText = typeof rawText === "string" ? rawText.trim().length > 0 : Array.isArray(rawText) && rawText.length > 0;
    const hasFacts = Array.isArray(facts.value) && facts.value.length > 0;
    value = {
      ...value,
      status: hasFacts || hasRawText ? value.status : "unknown",
      raw_text: hasRawText ? rawText : [],
      items: facts.value,
    };
  } else if ((name === "claims" || name === "care_role_candidates" || name === "capability_candidates") && Array.isArray(value)) {
    const facts = sanitizeFactArray(value, sectionRefs, blockedSourceIds);
    value = facts.value;
    factRefs = facts.evidenceRefs;
    factsChanged = facts.changed;
  }

  const retainedRefs = [...new Set([...sectionRefs, ...factRefs])];
  const hasValue = hasResearchValue(name, value);
  const sectionDropped = originalHasValue && (!hasValue || retainedRefs.length === 0);
  const changed = removedSectionRefs > 0 || factsChanged;
  if (!changed && !sectionDropped) return { section, sectionDropped: false };

  return {
    section: {
      ...section,
      value: sectionDropped ? null : value,
      evidence_refs: sectionDropped ? [] : retainedRefs,
      confidence: sectionDropped ? 0 : section.confidence,
      reasons: [
        ...section.reasons.slice(0, 19),
        sectionDropped
          ? "Blocked: no valid product/variant evidence remained for this section."
          : "Warning: blocked source references were removed; independently supported facts were retained.",
      ],
      has_conflict: sectionDropped ? true : section.has_conflict,
    },
    sectionDropped,
  };
}

function hasResearchValue(
  name: typeof evidenceBlockNames[number] | typeof hypothesisBlockNames[number],
  value: unknown,
) {
  if (Array.isArray(value)) return value.length > 0;
  if (name === "ingredients" && isPlainRecord(value)) {
    return (Array.isArray(value.items) && value.items.length > 0)
      || (Array.isArray(value.raw_text) && value.raw_text.length > 0)
      || (typeof value.raw_text === "string" && value.raw_text.trim().length > 0);
  }
  return value !== null && value !== undefined;
}

function sanitizeFactArray(
  value: unknown,
  sectionRefs: string[],
  blockedSourceIds: Set<string>,
): { value: unknown[]; evidenceRefs: string[]; changed: boolean } {
  if (!Array.isArray(value)) return { value: [], evidenceRefs: [], changed: value !== null && value !== undefined };
  const evidenceRefs: string[] = [];
  let changed = false;
  const facts = value.flatMap((fact) => {
    if (!isPlainRecord(fact)) {
      evidenceRefs.push(...sectionRefs);
      return sectionRefs.length > 0 ? [fact] : [];
    }
    const ownRefs = Array.isArray(fact.evidence_refs)
      ? fact.evidence_refs.filter((reference): reference is string => typeof reference === "string")
      : sectionRefs;
    const validRefs = ownRefs.filter((reference) => !blockedSourceIds.has(reference));
    if (validRefs.length === 0) {
      changed = true;
      return [];
    }
    if (validRefs.length !== ownRefs.length) changed = true;
    evidenceRefs.push(...validRefs);
    return [{ ...fact, evidence_refs: validRefs }];
  });
  return { value: facts, evidenceRefs: [...new Set(evidenceRefs)], changed };
}

const confidenceSectionNames = ["ingredients", "claims", "texture", "usage", "product_type"] as const;
type ConfidenceSectionName = typeof confidenceSectionNames[number];

function applySectionSourceTrust(
  result: Agent3ResearchResult,
  classifications: ClassifiedProductSearchResult[],
  blockedEvidenceSectionCount: number,
): { result: Agent3ResearchResult; diagnostic: Agent3ConfidenceDiagnostic } {
  const classificationByUrl = new Map(classifications.map((item) => [normalizeSourceUrl(item.url), item]));
  const sourceById = new Map(result.sources.map((source) => [source.source_id, source]));
  const matched = result.sources.flatMap((source) => {
    const classification = classificationByUrl.get(normalizeSourceUrl(source.url ?? source.URL ?? ""));
    return classification ? [{ source, classification }] : [];
  });
  const sourceClassCounts = countValues(matched.map((item) => item.classification.source_class));
  const sourceClassifications = result.sources.map((source) => {
    const classification = classificationByUrl.get(normalizeSourceUrl(source.url ?? source.URL ?? ""));
    return classification ? {
      source_id: source.source_id,
      source_class: classification.source_class,
      source_priority: classification.source_priority,
      classifier_reason: classification.classifier_reason,
      matched_name_or_alias: classification.matched_name_or_alias,
      observed_variant_markers: classification.observed_variant_markers,
      brand_owned_domain: classification.brand_owned_domain,
    } : {
      source_id: source.source_id,
      source_class: "unmatched",
      source_priority: "unknown",
      classifier_reason: "source_not_reconciled",
      matched_name_or_alias: null,
      observed_variant_markers: [],
      brand_owned_domain: false,
    };
  });
  const meaningfulSectionCount = confidenceSectionNames.filter((name) => hasResearchValue(name, result.research_payload[name].value)).length;
  const payload = { ...result.research_payload };
  const sectionTrust: Agent3ConfidenceDiagnostic["section_trust"] = {};

  for (const name of confidenceSectionNames) {
    const section = payload[name];
    if (!isResearchEvidenceBlock(section) || !hasResearchValue(name, section.value)) continue;
    const adjusted = applyEvidenceBlockTrust(name, section, sourceById, classificationByUrl, meaningfulSectionCount);
    payload[name] = adjusted.section as never;
    sectionTrust[name] = adjusted.diagnostic;
  }

  const sectionScores = Object.values(sectionTrust).map((item) => item.final_confidence);
  const aggregateTrust = sectionScores.length > 0
    ? Math.round(sectionScores.reduce((sum, value) => sum + value, 0) / sectionScores.length)
    : blockedEvidenceSectionCount > 0 ? 40 : 55;
  const rawConfidence = result.overall_confidence;
  const finalConfidence = typeof rawConfidence === "number" ? Math.min(rawConfidence, aggregateTrust) : rawConfidence;
  const bindingReasons = [...new Set(Object.values(sectionTrust)
    .filter((item) => item.final_confidence < item.raw_confidence)
    .map((item) => item.cap_reason))];
  const capReason = rawConfidence === null
    ? "model_raw_confidence_missing"
    : finalConfidence === rawConfidence
    ? "model_raw_confidence"
    : bindingReasons.length === 1
      ? bindingReasons[0]!
      : blockedEvidenceSectionCount > 0 && sectionScores.length === 0
        ? "blocked_evidence_section"
        : "section_trust_aggregate";
  const diagnostic: Agent3ConfidenceDiagnostic = {
    raw_confidence: rawConfidence,
    cap: aggregateTrust,
    cap_reason: capReason,
    final_confidence: finalConfidence,
    matched_source_count: matched.length,
    unmatched_source_count: result.sources.length - matched.length,
    source_class_counts: sourceClassCounts,
    source_classifications: sourceClassifications,
    section_trust: sectionTrust,
  };
  return {
    result: agent3ResearchResultSchema.parse({ ...result, research_payload: payload, overall_confidence: finalConfidence }),
    diagnostic,
  };
}

function applyEvidenceBlockTrust(
  name: ConfidenceSectionName,
  section: ResearchEvidenceBlock,
  sourceById: Map<string, Agent3ResearchResult["sources"][number]>,
  classificationByUrl: Map<string, ClassifiedProductSearchResult>,
  meaningfulSectionCount: number,
) {
  const facts = name === "ingredients" && isPlainRecord(section.value) && Array.isArray(section.value.items)
    ? section.value.items
    : name === "claims" && Array.isArray(section.value)
      ? section.value
      : null;
  if (facts?.length) {
    const factTrust = facts.map((fact) => {
      const record = isPlainRecord(fact) ? fact : null;
      const refs = record && Array.isArray(record.evidence_refs)
        ? record.evidence_refs.filter((ref): ref is string => typeof ref === "string")
        : section.evidence_refs;
      const cap = evidenceRefsConfidenceCap(refs, sourceById, classificationByUrl, meaningfulSectionCount);
      const raw = record && typeof record.confidence === "number" ? record.confidence : section.confidence;
      return { fact, raw, cap, final: Math.min(raw, cap.cap) };
    });
    const value = name === "ingredients" && isPlainRecord(section.value)
      ? { ...section.value, items: factTrust.map(({ fact, final }) => isPlainRecord(fact) ? { ...fact, confidence: final } : fact) }
      : factTrust.map(({ fact, final }) => isPlainRecord(fact) ? { ...fact, confidence: final } : fact);
    const cap = Math.round(factTrust.reduce((sum, item) => sum + item.cap.cap, 0) / factTrust.length);
    const final = Math.round(factTrust.reduce((sum, item) => sum + item.final, 0) / factTrust.length);
    return {
      section: { ...section, value, confidence: final },
      diagnostic: {
        raw_confidence: section.confidence,
        cap,
        cap_reason: lowestCapReason(factTrust.map((item) => item.cap)),
        final_confidence: final,
      },
    };
  }
  const cap = evidenceRefsConfidenceCap(section.evidence_refs, sourceById, classificationByUrl, meaningfulSectionCount);
  return {
    section: { ...section, confidence: Math.min(section.confidence, cap.cap) },
    diagnostic: {
      raw_confidence: section.confidence,
      cap: cap.cap,
      cap_reason: cap.reason,
      final_confidence: Math.min(section.confidence, cap.cap),
    },
  };
}

function evidenceRefsConfidenceCap(
  refs: string[],
  sourceById: Map<string, Agent3ResearchResult["sources"][number]>,
  classificationByUrl: Map<string, ClassifiedProductSearchResult>,
  meaningfulSectionCount: number,
): { cap: number; reason: SourceConfidenceCapReason } {
  const classified = refs.flatMap((ref) => {
    const source = sourceById.get(ref);
    if (!source) return [];
    const classification = classificationByUrl.get(normalizeSourceUrl(source.url ?? source.URL ?? ""));
    return classification ? [classification] : [];
  });
  if (!classified.length) return { cap: 55, reason: "source_not_reconciled" };
  const usable = classified.filter((item) => !blockedSourceClasses.has(item.source_class)
    && item.source_class !== "exact_variant_uncertain");
  if (!usable.length && classified.some((item) => item.source_class === "exact_variant_uncertain")) {
    return { cap: 55, reason: "exact_variant_uncertain" };
  }
  const priorities = new Set(usable.map((item) => item.source_priority));
  if (priorities.has("official_product") || priorities.has("brand_owner") || priorities.has("official_store")) {
    return meaningfulSectionCount >= 4
      ? { cap: 100, reason: "authoritative_source_broad_coverage" }
      : { cap: 85, reason: "authoritative_source_limited_coverage" };
  }
  if (priorities.has("retail")) return { cap: 70, reason: "retail_source_mix" };
  return { cap: 55, reason: "weak_source_mix" };
}

function lowestCapReason(values: Array<{ cap: number; reason: SourceConfidenceCapReason }>) {
  const minimum = Math.min(...values.map((item) => item.cap));
  const reasons = [...new Set(values.filter((item) => item.cap === minimum).map((item) => item.reason))];
  return reasons.length === 1 ? reasons[0]! : "section_fact_aggregate";
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

type SourceConfidenceCapReason =
  | "exact_variant_uncertain"
  | "source_not_reconciled"
  | "authoritative_source_broad_coverage"
  | "authoritative_source_limited_coverage"
  | "retail_source_mix"
  | "weak_source_mix";

function normalizeSourceUrl(value: string) {
  return value.trim().toLowerCase().replace(/\/$/, "");
}

const researchEvidenceBlockNames = ["identity", "ingredients", "claims", "texture", "usage", "product_type"] as const;

/**
 * A narrowly observed Agent-Plan transport drift: one evidence block can
 * serialize its explanatory `reasons` array as a single string. This makes
 * no factual change; malformed non-array values become the existing empty
 * explanation representation and all other transport fields remain strict.
 */
function normalizeTransportReasons(value: unknown): {
  value: unknown;
  stringReasons: number;
  malformedReasons: number;
  candidateArraysWrapped: number;
  malformedCandidatesDropped: number;
} {
  if (!isPlainRecord(value) || !isPlainRecord(value.research_payload)) {
    return { value, stringReasons: 0, malformedReasons: 0, candidateArraysWrapped: 0, malformedCandidatesDropped: 0 };
  }
  let stringReasons = 0;
  let malformedReasons = 0;
  let candidateArraysWrapped = 0;
  let malformedCandidatesDropped = 0;
  let payloadChanged = false;
  const payload = { ...value.research_payload };
  for (const name of researchEvidenceBlockNames) {
    const block = payload[name];
    if (!isPlainRecord(block) || !("reasons" in block)) continue;
    if (typeof block.reasons === "string") {
      payload[name] = { ...block, reasons: block.reasons.trim() ? [block.reasons.trim()] : [] };
      stringReasons += 1;
      payloadChanged = true;
    } else if (!Array.isArray(block.reasons)) {
      payload[name] = { ...block, reasons: [] };
      malformedReasons += 1;
      payloadChanged = true;
    }
  }
  for (const name of hypothesisBlockNames) {
    const candidateField = payload[name];
    if (candidateField === undefined) continue;
    if (Array.isArray(candidateField)) {
      const candidates = candidateField.filter(isPlainRecord);
      const evidenceRefs = [...new Set(candidates.flatMap((candidate) =>
        Array.isArray(candidate.evidence_refs)
          ? candidate.evidence_refs.filter((reference): reference is string => typeof reference === "string")
          : []
      ))].slice(0, 100);
      const confidence = candidates.reduce((maximum, candidate) =>
        typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
          ? Math.max(maximum, candidate.confidence)
          : maximum, 0);
      payload[name] = {
        value: candidates,
        evidence_refs: evidenceRefs,
        confidence,
        reasons: ["Normalized optional candidate array envelope."],
        has_conflict: false,
        includes_ai_inference: true,
      };
      candidateArraysWrapped += 1;
      payloadChanged = true;
    } else if (!isPlainRecord(candidateField)) {
      delete payload[name];
      malformedCandidatesDropped += 1;
      payloadChanged = true;
    }
  }
  return {
    value: payloadChanged ? { ...value, research_payload: payload } : value,
    stringReasons,
    malformedReasons,
    candidateArraysWrapped,
    malformedCandidatesDropped,
  };
}

function normalizeAgent3Transport(value: unknown) {
  const reasons = normalizeTransportReasons(value);
  const ingredients = normalizeIngredientsRepresentation(reasons.value);
  const ingredientTrust = normalizeModelDeclaredIngredientDifferences(ingredients.value);
  const identity = normalizeIdentityValue(ingredientTrust.value);
  const sources = normalizeResearchSources(identity.value);
  const isolated = isolateAgent3ResearchSections(sources.value);
  return {
    ...reasons,
    value: isolated.value,
    ingredientsRepresentationsNormalized: ingredients.normalized + ingredientTrust.normalized,
    malformedSections: isolated.malformedSections,
    sourcesNormalized: sources.normalized,
  };
}

/**
 * Agent3 can identify a plausible formula/list difference, but it cannot
 * promote that observation to a deterministic hard conflict. Preserve the
 * description and evidence as an ingredient uncertainty while keeping valid
 * source-backed facts available for the existing downstream trust filters.
 */
function normalizeModelDeclaredIngredientDifferences(value: unknown): { value: unknown; normalized: number } {
  if (!isPlainRecord(value) || !isPlainRecord(value.research_payload)) return { value, normalized: 0 };
  const section = value.research_payload.ingredients;
  if (!isPlainRecord(section) || !isPlainRecord(section.value)) return { value, normalized: 0 };
  const ingredientValue = section.value;
  const differences = Array.isArray(ingredientValue.conflicts) ? ingredientValue.conflicts : [];
  const hasFacts = Array.isArray(ingredientValue.items) && ingredientValue.items.length > 0;
  if (!hasFacts || (differences.length === 0 && section.has_conflict !== true && ingredientValue.status !== "conflicted")) {
    return { value, normalized: 0 };
  }
  const uncertainties = differences.flatMap(modelDeclaredIngredientUncertainty);
  if (uncertainties.length === 0 && section.has_conflict === true) {
    const description = Array.isArray(section.reasons)
      ? section.reasons.find((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
      : null;
    if (description) uncertainties.push({
      field: "ingredients.source_difference",
      description: description.trim(),
      evidence_refs: Array.isArray(section.evidence_refs) ? section.evidence_refs : [],
    });
  }
  const existingUncertainties = value.research_payload.uncertainties;
  if (existingUncertainties !== undefined && !Array.isArray(existingUncertainties)) return { value, normalized: 0 };
  const nextValue = {
    ...ingredientValue,
    status: ingredientValue.status === "conflicted" ? "partial" : ingredientValue.status,
    conflicts: [],
  };
  return {
    value: {
      ...value,
      research_payload: {
        ...value.research_payload,
        ingredients: { ...section, value: nextValue, has_conflict: false },
        uncertainties: [...(existingUncertainties ?? []), ...uncertainties],
      },
    },
    normalized: 1,
  };
}

function modelDeclaredIngredientUncertainty(value: unknown) {
  if (!isPlainRecord(value)) return [];
  const refs = Array.isArray(value.evidence_refs)
    ? value.evidence_refs.filter((ref): ref is string => typeof ref === "string")
    : [];
  if (typeof value.description === "string" && value.description.trim()) {
    const kind = typeof value.type === "string" && value.type.trim() ? value.type.trim() : "source_difference";
    return [{ field: `ingredients.${kind}`, description: value.description.trim(), evidence_refs: refs }];
  }
  const values = Array.isArray(value.values)
    ? value.values.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (values.length >= 2) {
    const field = typeof value.field === "string" && value.field.trim() ? value.field.trim() : "source_difference";
    return [{ field: `ingredients.${field}`, description: values.join(" / "), evidence_refs: refs }];
  }
  return [];
}

const ingredientValueKeys = ["status", "raw_text", "items", "conflicts"] as const;
const ingredientEvidenceKeys = ["evidence_refs", "confidence", "reasons", "has_conflict", "includes_ai_inference"] as const;
const ingredientSectionKeys = new Set<string>([...ingredientValueKeys, ...ingredientEvidenceKeys]);

/**
 * Normalizes two observed, semantically unambiguous Agent3 representations
 * before strict section isolation. It never changes ingredient items or
 * evidence: a flattened evidence block is wrapped, and a per-item raw-text
 * duplicate is removed because `items` remains the fact-bearing structure.
 */
function normalizeIngredientsRepresentation(value: unknown): { value: unknown; normalized: number } {
  if (!isPlainRecord(value) || !isPlainRecord(value.research_payload)) return { value, normalized: 0 };
  const original = value.research_payload.ingredients;
  if (!isPlainRecord(original)) return { value, normalized: 0 };

  let section: Record<string, unknown> = original;
  let normalized = 0;
  const hasCanonicalValue = Object.prototype.hasOwnProperty.call(section, "value");
  const hasFlattenedValue = ingredientValueKeys.some((key) => Object.prototype.hasOwnProperty.call(section, key));
  if (!hasCanonicalValue && hasFlattenedValue && isSafeFlattenedIngredientsSection(section)) {
    section = {
      value: Object.fromEntries(ingredientValueKeys.flatMap((key) =>
        Object.prototype.hasOwnProperty.call(section, key) ? [[key, section[key]]] : []
      )),
      ...Object.fromEntries(ingredientEvidenceKeys.map((key) => [key, section[key]])),
    };
    normalized += 1;
  }

  if (isPlainRecord(section.value)) {
    const compacted = compactIngredientRawText(section.value.raw_text, section.value.items);
    if (compacted.changed) {
      section = { ...section, value: { ...section.value, raw_text: compacted.value } };
      normalized += 1;
    }
  }
  if (normalized === 0) return { value, normalized };
  return {
    value: { ...value, research_payload: { ...value.research_payload, ingredients: section } },
    normalized,
  };
}

function isSafeFlattenedIngredientsSection(section: Record<string, unknown>) {
  if (Object.keys(section).some((key) => !ingredientSectionKeys.has(key))) return false;
  if (!ingredientValueKeys.slice(0, 3).every((key) => Object.prototype.hasOwnProperty.call(section, key))) return false;
  if (!ingredientEvidenceKeys.every((key) => Object.prototype.hasOwnProperty.call(section, key))) return false;
  if (!boundedStrings(section.evidence_refs, 100, 200)) return false;
  if (typeof section.confidence !== "number" || !Number.isFinite(section.confidence)) return false;
  if (!boundedStrings(section.reasons, 20, 500)) return false;
  if (typeof section.has_conflict !== "boolean" || typeof section.includes_ai_inference !== "boolean") return false;
  if (!new Set(["found", "partial", "conflicted", "unknown"]).has(section.status as string)) return false;
  if (!(boundedText(section.raw_text, 50_000)
    || (boundedStrings(section.raw_text, 500, 50_000)))) return false;
  if (!Array.isArray(section.items) || section.items.length > 500) return false;
  return section.conflicts === undefined || (Array.isArray(section.conflicts) && section.conflicts.length <= 100);
}

function boundedStrings(value: unknown, maximumItems: number, maximumLength: number) {
  return Array.isArray(value) && value.length <= maximumItems
    && value.every((item) => boundedText(item, maximumLength));
}

function boundedText(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;
}

function compactIngredientRawText(rawText: unknown, items: unknown): { value: unknown; changed: boolean } {
  if (!Array.isArray(rawText) || !Array.isArray(items) || rawText.length === 0) return { value: rawText, changed: false };
  const declarations = rawText.every((item) => typeof item === "string" && item.trim().length > 0)
    ? rawText.map((item) => (item as string).trim())
    : null;
  if (!declarations) return { value: rawText, changed: false };
  const itemNames = new Set(items.flatMap((item) => {
    if (typeof item === "string") return [normalizeIngredientText(item)];
    if (!isPlainRecord(item)) return [];
    const names = [item.raw_name, item.name, item.normalized_name];
    return names.flatMap((name) => typeof name === "string" && name.trim() ? [normalizeIngredientText(name)] : []);
  }));
  if (itemNames.size > 0 && declarations.every((entry) => itemNames.has(normalizeIngredientText(entry)))) {
    return { value: [], changed: true };
  }
  if (declarations.length <= 20) return { value: declarations, changed: false };
  const joined = declarations.join("\n");
  // A normal complete INCI easily fits this established per-declaration
  // resource bound. Oversized content remains malformed instead of being
  // silently truncated or allowed to consume unbounded resources.
  return joined.length <= 50_000
    ? { value: [joined], changed: true }
    : { value: rawText, changed: false };
}

function normalizeIngredientText(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

/** Retains only V1 identity aliases; Catalog remains the durable identity owner. */
function normalizeIdentityValue(value: unknown): { value: unknown } {
  if (!isPlainRecord(value) || !isPlainRecord(value.research_payload)) return { value };
  const block = value.research_payload.identity;
  if (!isPlainRecord(block) || !isPlainRecord(block.value)) return { value };
  const aliases = Array.isArray(block.value.aliases)
    ? block.value.aliases
    : Array.isArray(block.value.alias)
      ? block.value.alias
      : [];
  return {
    value: {
      ...value,
      research_payload: {
        ...value.research_payload,
        identity: { ...block, value: { aliases } },
      },
    },
  };
}

function normalizeResearchSources(value: unknown): { value: unknown; normalized: number } {
  if (!isPlainRecord(value) || !Array.isArray(value.sources)) return { value, normalized: 0 };
  let normalized = 0;
  const sources = value.sources.map((item) => {
    if (!isPlainRecord(item)) return item;
    const url = typeof item.url === "string" ? item.url : typeof item.URL === "string" ? item.URL : "";
    const title = typeof item.title === "string" ? item.title : "";
    const sourceType = canonicalSourceType(item.source_type, title, url);
    const authorityTier = authorityTierForSourceType(sourceType);
    if (item.source_type !== sourceType || item.authority_tier !== authorityTier) normalized += 1;
    return { ...item, source_type: sourceType, authority_tier: authorityTier };
  });
  return { value: { ...value, sources }, normalized };
}

type Agent3SourceType = typeof AGENT3_RESEARCH_SOURCE_TYPES[number];
const agent3SourceTypes = new Set<string>(AGENT3_RESEARCH_SOURCE_TYPES);

function canonicalSourceType(value: unknown, title: string, url: string): Agent3SourceType {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (agent3SourceTypes.has(raw)) return raw as Agent3SourceType;
  if (/备案|监管|regulatory|filing/u.test(raw)) return "regulatory_record";
  if (/包装|瓶身|package|label/u.test(raw)) return "package_label";
  if (/成分数据库|ingredient database|open.?dataset/u.test(raw)) return "open_dataset";
  const priority = classifySourcePriority({
    title,
    url,
    snippet: null,
    summary: null,
    site_name: raw || null,
    rank_score: null,
    authority_level: null,
    authority_description: null,
  });
  if (priority === "official_product") return "official_product_page";
  if (priority === "brand_owner") return "brand_owner";
  if (priority === "official_store") return "official_store";
  if (priority === "retail" || /电商|零售|商品/u.test(raw)) return "retailer";
  if (priority === "aggregation" || /聚合|导购|比价|搜索结果/u.test(raw)) return "aggregation";
  if (priority === "third_party" || /测评|评测|评价|文章|内容/u.test(raw)) return "third_party";
  if (/官网|官方|品牌方/u.test(raw)) return "official_website";
  return "unknown";
}

function authorityTierForSourceType(sourceType: Agent3SourceType) {
  if (["official_brand", "brand_owner", "official_product_page", "official_website", "regulatory_record", "package_label"].includes(sourceType)) return 1;
  if (["official_retailer", "official_store", "open_dataset", "user_submitted"].includes(sourceType)) return 2;
  if (sourceType === "retailer") return 3;
  if (sourceType === "aggregation" || sourceType === "third_party") return 5;
  return null;
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createConfiguredVolcengineAgentPlanProductResearchProvider(): ProductResearchProvider | null {
  const apiKey = process.env.VOLCENGINE_AGENT_PLAN_KEY?.trim();
  const model = process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim();
  const baseUrl = process.env.VOLCENGINE_AGENT_PLAN_BASE_URL?.trim();
  return apiKey && model && baseUrl ? createVolcengineAgentPlanProductResearchProvider({ apiKey, model, baseUrl, diagnostics: createDevelopmentAgent3RawDiagnosticCapture() }) : null;
}

async function recordDiagnostic(
  diagnostics: Agent3RawDiagnosticCapture | undefined,
  input: ProductResearchInput,
  model: string,
  startedAt: number,
  researchRunId: string | null,
  rawFinalOutput: string | null,
  transportValidation: Parameters<Agent3RawDiagnosticCapture["recordProviderCompletion"]>[1]["transportValidation"],
  confidenceDiagnostic?: Agent3ConfidenceDiagnostic,
) {
  return diagnostics?.recordProviderCompletion(input, {
    model,
    startedAt: new Date(startedAt),
    completedAt: new Date(),
    researchRunId,
    rawFinalOutput,
    transportValidation,
    confidenceDiagnostic,
  }) ?? null;
}
function runIdFromJson(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { research_run_id?: unknown }).research_run_id === "string"
    ? (value as { research_run_id: string }).research_run_id
    : null;
}

export const productResearchPrompt = `You are Beauty OS Product Research v1.0. Return ONLY one JSON object, with no Markdown fences or prose. Its exact top-level keys are research_payload, sources, overall_confidence, and research_run_id. Do not add any other keys.

sources is a non-empty array. Every source has exactly source_id, url, title, source_type, authority_tier, retrieved_at. source_id, url, title, and source_type are non-empty JSON strings. url is one real HTTPS source URL; use the lowercase key url, never URL. source_type is exactly one of: ${AGENT3_RESEARCH_SOURCE_TYPES.join(", ")}. Set authority_tier to null; Beauty OS derives authority deterministically. retrieved_at is an RFC 3339 datetime string with timezone, for example 2026-08-28T00:00:00.000Z. Never invent a source or URL.

research_payload contains evidence blocks for identity, ingredients, claims, texture, usage, and product_type, plus optional care_role_candidates, capability_candidates, uncertainties and conflicts. Each evidence block is { value, evidence_refs, confidence, reasons, has_conflict, includes_ai_inference }. Every evidence_refs value must exactly reference a top-level sources[].source_id. Every confidence, including overall_confidence and any item confidence, is a JSON integer from 0 through 100: never a decimal, fraction, percent string, or label. For unknown evidence use value:null, evidence_refs:[], confidence:0, and a brief reason.

Use these exact value contracts:
- identity.value is { aliases: string[] }. Catalog brand, product and variant are authoritative input facts; never replace them. Barcode is not a Product Research target and is intentionally absent from INPUT: do not search, infer, validate, score, or discuss it.
- ingredients.value is { status: found|partial|unknown, raw_text: string|string[], items: Array<{ raw_name, normalized_name, ingredient_order, confidence, evidence_refs }>, conflicts?: [] }. Use per-item evidence_refs whenever possible. A possible source, region, or formula-version difference is model-declared uncertainty, not a hard section conflict: keep supported items available and report the detail in research_payload.uncertainties as { field: "ingredients.<kind>", description, evidence_refs }.
- claims.value is Array<{ raw_text, normalized_claim, confidence, evidence_refs }>.
- texture.value is one product-specific factual string.
- usage.value is { instructions: string[], am_pm: (am|pm)[], frequency: string|null, routine_order: string|null, leave_on: boolean|null, rinse_off: boolean|null, cautions: string[] }. Do not invent other usage keys or personalized suitability.
- product_type.value is null or exactly one of: ${PRODUCT_TYPES.join(", ")}.

LANGUAGE CONTRACT:
- Beauty OS consumer-facing normalized knowledge MUST be natural Simplified Chinese, even when every source is English or sources use mixed languages.
- Keep source-facing facts in their source language without translation: Catalog-confirmed brand/product/variant, ingredients.value.raw_text, every ingredients.value.items[].raw_name, every claims.value[].raw_text, sources[].title, sources[].url, and all evidence_refs.
- Every claims.value[] item MUST use the object form and MUST include normalized_claim as a faithful Simplified-Chinese structured claim. Do not strengthen marketing language or turn a cosmetic claim into a medical conclusion.
- texture.value, usage.value.instructions[], usage.value.frequency, usage.value.routine_order, usage.value.cautions[], and consumer-facing uncertainty descriptions MUST be faithful Simplified-Chinese structured facts. Preserve conditions, strength, negation, scope, and uncertainty. A translated caution must never weaken the source warning or add a fact absent from the source.
- Ingredient normalized_name may use a reliable Simplified-Chinese display name when supported, but raw_name must remain the original INCI/source name.
- Translation or normalization never changes evidence_refs. Do not create a translated source title or replace raw evidence with the Chinese presentation.
- Do not mechanically translate wording when a concise Chinese structured fact is clearer, but do not infer, expand, or personalize it. In particular, never rewrite a limited statement about transient tingling into an assertion that pain or irritation proves the product is working.

care_role_candidates and capability_candidates are optional evidence-block objects using that same envelope; their value is the candidate array. Never return either optional field as a bare array. If omitted or malformed, Beauty OS drops only that optional interpretation field and keeps valid core research sections.

INPUT includes search_results supplied by Beauty OS. They are search-provider-returned candidate sources: title, URL, snippet, summary, and site metadata. Prefer these exact URLs as research leads. Do not invent a URL, and do not claim that a supplied source contains a fact absent from its supplied snippet or summary. A supplied search result is not application-verified evidence. Do not treat another SKU, generation, or variant as exact support.

INPUT also includes research_mode and enrichment_focus. In broad mode, establish the complete core baseline. In gap_targeted mode, prioritize only the named missing sections; do not mechanically repeat already researched sections. Use the supplied search leads first, and use web_search only when those leads do not support the requested sections.

Only output a Product Knowledge fact when a source in this response gives product-specific support for the exact confirmed Catalog product and variant in INPUT. Sources are model-reported research provenance, not application-verified evidence. Do not use general skincare knowledge, typical usage, generic safety advice, model inference, another SKU, another generation, or same-series assumptions as product facts. If the exact variant is not confirmed, omit the fact or report it as unknown/uncertain. In particular, do not output pregnancy advice, patch-test advice, acid-layering advice, or other generic cautions unless product-specific material explicitly supports it.

Never guess INCI, concentration, ingredient order, public claim, source, texture, usage, or cautions. Research only the confirmed Catalog product in INPUT: identity aliases, ingredients, public claims, product type, texture, and product-specific usage/cautions. Do not search for or output shelf life, PAO / period after opening, opened-product lifetime, 6M / 12M / 24M labels, or any expiry calculation. Different sections may use appropriate sources: prefer regulatory/official/package evidence for ingredients, official or brand-owner material for claims, official/package/official-store instructions for usage and cautions, and official or reliable retailer factual descriptions for texture. Marketing claims remain claims, not medical facts. You may include care_role_candidates or capability_candidates only as source-referenced research hypotheses for follow-up; their value is an array of { code, confidence, evidence_refs }. They are not verified Product Knowledge, not routine advice, and must not be based on generic skincare knowledge. Do not output personalized suitability, Beauty OS interpretation, generic skincare advice, manufacturer systems, filing systems, barcode research, or risk taxonomies. Do not publish knowledge.`;
