import "server-only";

import { z } from "zod";

import type { ProductResearchInput } from "@/schemas/product-research";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";
import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import type { ProductResearchProvider } from "@/server/product-research/volcengine-agent-plan-provider";
import type { ProductSearchProvider } from "@/server/product-search/product-search-provider";
import { canonicalOfficialIdentitySourceType } from "@/server/product-search/product-search-source-classifier";
import { getAgent3DiagnosticId, ProductResearchUnavailableError } from "@/server/product-research/volcengine-agent-plan-provider";
import { recordDevelopmentAgent3DiagnosticOutcome } from "@/server/product-research/agent3-raw-diagnostic";
import { buildProductResearchDraftResult, hasMeaningfulProductResearchContent } from "@/server/services/product-research-draft-builder";
import { createProductResearchDraftService } from "@/server/services/product-research-draft-service";
import {
  effectiveProductResearchDraft,
  hasCompleteEnoughProductResearch,
  missingProductResearchSections,
  productResearchDelta,
} from "@/server/services/effective-product-research-draft";

export type ProductResearchRunStatus = "not_started" | "running" | "completed" | "partial" | "failed";
export type ProductResearchTriggerResult = "started" | "partial" | "already_running" | "existing_draft" | "verified_knowledge" | "failed";

// This is deliberately a small per-process guard, not a task queue. The
// durable deduplication point is the existing latest draft for the Catalog ID.
const runningCatalogProducts = new Set<string>();
const MAX_AUTOMATIC_ENRICHMENT_RUNS = 2;
const MAX_TRANSIENT_PROVIDER_ATTEMPTS = 2;
const MAX_TRANSIENT_SEARCH_ATTEMPTS = 2;
function agent3Debug(stage: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") {
    if (stage === "failed") {
      console.error("AGENT3_RESEARCH_FAILED", {
        failure_kind: typeof payload.failure_kind === "string" ? payload.failure_kind : "unknown_provider_error",
        draft_created: payload.draft_created === true,
      });
    }
    return;
  }
  console.info("AGENT3_RESEARCH_DEBUG", { stage, ...payload });
}

export type ProductResearchTriggerService = {
  trigger(input: ProductResearchInput): Promise<ProductResearchTriggerResult>;
  /**
   * Explicit Admin maintenance action. Unlike the automatic trigger, this
   * intentionally creates a new immutable AI research snapshot even when a
   * usable snapshot or verified knowledge already exists.
   */
  rerun(input: ProductResearchInput): Promise<ProductResearchTriggerResult>;
  status(catalogProductId: string): ProductResearchRunStatus;
};

export function createProductResearchTriggerService(dependencies: {
  provider: ProductResearchProvider | null;
  drafts: ProductResearchDraftRepository;
  knowledge: KnowledgeRepository;
  model: string | null;
  searchProvider?: ProductSearchProvider | null;
}): ProductResearchTriggerService {
  const draftService = createProductResearchDraftService(dependencies.drafts);
  const completed = new Set<string>();
  const partial = new Set<string>();
  const failed = new Set<string>();

  return {
    status(catalogProductId) {
      if (runningCatalogProducts.has(catalogProductId)) return "running";
      if (completed.has(catalogProductId)) return "completed";
      if (partial.has(catalogProductId)) return "partial";
      if (failed.has(catalogProductId)) return "failed";
      return "not_started";
    },
    async trigger(input) {
      return run(input, false);
    },
    async rerun(input) {
      return run(input, true);
    },
  };

  async function run(input: ProductResearchInput, isExplicitRerun: boolean): Promise<ProductResearchTriggerResult> {
      if (!dependencies.provider) {
        agent3Debug("failed", { catalog_product_id_present: true, failure_kind: "provider_not_configured" });
        researchTerminal("failed", false, 0, [], 0);
        return "failed";
      }
      if (runningCatalogProducts.has(input.catalog_product_id)) {
        return "already_running";
      }
      runningCatalogProducts.add(input.catalog_product_id);
      failed.delete(input.catalog_product_id);
      partial.delete(input.catalog_product_id);
      let diagnosticId: string | null = null;
      let draftCreated = false;
      let latest: Awaited<ReturnType<typeof draftService.getLatestDraft>> = null;
      let effective: Awaited<ReturnType<typeof draftService.getLatestUsableDraft>> = null;
      let rounds = 0;
      let addedFactCount = 0;
      try {
        latest = await draftService.getLatestDraft(input.catalog_product_id);
        effective = await draftService.getLatestUsableDraft(input.catalog_product_id);
        if (!isExplicitRerun
          && hasCompleteEnoughProductResearch(effective)
          && await hasSufficientVerifiedKnowledge(dependencies.knowledge, input.catalog_product_id)) {
          completed.add(input.catalog_product_id);
          researchTerminal("verified_knowledge", false, rounds, [], addedFactCount);
          return "verified_knowledge";
        }
        // A usable snapshot only deduplicates automatic work once its
        // independently projected sections are complete enough. Partial
        // research is a prompt to fill precise gaps, not a terminal state.
        if (!isExplicitRerun && hasCompleteEnoughProductResearch(effective)) {
          completed.add(input.catalog_product_id);
          researchTerminal("existing_draft", false, rounds, [], addedFactCount);
          return "existing_draft";
        }
        const classifierContextInput = withExistingResearchIdentityContext(input, effective);
        const runLimit = isExplicitRerun ? 1 : MAX_AUTOMATIC_ENRICHMENT_RUNS;
        for (let run = 0; run < runLimit; run += 1) {
          const enrichmentFocus = missingProductResearchSections(effective);
          const researchMode = !effective || (isExplicitRerun && enrichmentFocus.length === 0)
            ? "broad"
            : "gap_targeted";
          const beforeRound = effective;
          rounds += 1;
          const researchInput = await enrichWithSearchResults(
            {
              ...classifierContextInput,
              research_mode: researchMode,
              ...(enrichmentFocus.length ? { enrichment_focus: enrichmentFocus } : {}),
            },
            dependencies.searchProvider,
          );
          const providerResult = await researchWithTransientRetry(dependencies.provider, researchInput);
          diagnosticId = getAgent3DiagnosticId(providerResult);
          const result = buildProductResearchDraftResult(researchInput, providerResult);
          if (!hasMeaningfulProductResearchContent(result)) {
            const usablePartialExists = effective !== null;
            if (usablePartialExists) partial.add(input.catalog_product_id);
            else failed.add(input.catalog_product_id);
            await recordDevelopmentAgent3DiagnosticOutcome(diagnosticId, { schema_success: true, failure_kind: "no_meaningful_content", draft_created: false });
            agent3Debug("failed", { catalog_product_id_present: true, failure_kind: "no_meaningful_content" });
            researchTerminal(
              usablePartialExists ? "partial" : "failed",
              draftCreated,
              rounds,
              missingProductResearchSections(effective),
              addedFactCount,
            );
            return usablePartialExists ? "partial" : "failed";
          }
          await recordDevelopmentAgent3DiagnosticOutcome(diagnosticId, { schema_success: true, failure_kind: null });
          const created = await draftService.createDraft({
            catalog_product_id: input.catalog_product_id,
            research_version: (latest?.research_version ?? 0) + 1,
            research_payload: result.research_payload,
            overall_confidence: result.overall_confidence,
            created_by: "ai",
            research_model: dependencies.model,
            research_run_id: result.research_run_id,
          });
          latest = created;
          draftCreated = true;
          effective = effectiveProductResearchDraft([created, ...(effective ? [effective] : [])]);
          const delta = productResearchDelta(beforeRound, effective);
          addedFactCount += delta.added_fact_count;
          agent3Debug("research_delta", {
            round: rounds,
            added_fact_count: delta.added_fact_count,
            preserved_fact_count: delta.preserved_fact_count,
            invalidated_fact_count: delta.invalidated_fact_count,
            newly_completed_sections: delta.newly_completed_sections,
            remaining_sections: delta.remaining_sections,
          });
          await recordDevelopmentAgent3DiagnosticOutcome(diagnosticId, { draft_created: true });
          if (isExplicitRerun || hasCompleteEnoughProductResearch(effective)) break;
        }
        if (hasCompleteEnoughProductResearch(effective)) {
          completed.add(input.catalog_product_id);
          researchTerminal("completed", draftCreated, rounds, [], addedFactCount);
          return "started";
        }
        partial.add(input.catalog_product_id);
        researchTerminal("partial", draftCreated, rounds, missingProductResearchSections(effective), addedFactCount);
        return "partial";
      } catch (error) {
        const usablePartialExists = effective !== null;
        if (usablePartialExists) partial.add(input.catalog_product_id);
        else failed.add(input.catalog_product_id);
        const capturedDiagnosticId = error instanceof ProductResearchUnavailableError ? error.diagnosticId : diagnosticId;
        if (error instanceof z.ZodError) {
          agent3Debug("draft_composition_validation", {
            schema_success: false,
            issues: error.issues.slice(0, 5).map((issue) => ({
              path: issue.path.join("."),
              code: issue.code,
              message: issue.message,
            })),
          });
        }
        agent3Debug("failed", {
          catalog_product_id_present: true,
          failure_kind: error instanceof ProductResearchUnavailableError
            ? error.failureKind
            : error instanceof z.ZodError
              ? "schema_error"
              : "unknown_provider_error",
        });
        await recordDevelopmentAgent3DiagnosticOutcome(capturedDiagnosticId, {
          schema_success: error instanceof z.ZodError ? false : null,
          failure_kind: error instanceof ProductResearchUnavailableError
            ? error.failureKind
            : error instanceof z.ZodError
              ? "schema_error"
              : "unknown_provider_error",
          draft_created: draftCreated,
        });
        researchTerminal(
          usablePartialExists ? "partial" : "failed",
          draftCreated,
          rounds,
          missingProductResearchSections(effective),
          addedFactCount,
        );
        return usablePartialExists ? "partial" : "failed";
      } finally {
        runningCatalogProducts.delete(input.catalog_product_id);
      }
  }
}

/**
 * Reuses only already persisted identity evidence for source classification.
 * This context is request-local: it neither mutates the Catalog identity nor
 * promotes an Agent3 alias/source into a new durable identity fact.
 */
function withExistingResearchIdentityContext(
  input: ProductResearchInput,
  effective: ProductResearchDraft | null,
): ProductResearchInput {
  if (!effective) return input;
  const payload = effective.research_payload;
  const aliases = [...new Set([...input.aliases, ...payload.identity.aliases].map((value) => value.trim()).filter(Boolean))].slice(0, 30);
  const identityRefs = new Set(payload.identity.evidence_refs);
  const persistedIdentitySources = payload.sources
    .filter((source) => source.url !== null
      && identityRefs.has(source.source_id)
      && canonicalOfficialIdentitySourceType(source.source_type) !== null)
    .map((source) => ({ url: source.url!, title: source.title, source_type: canonicalOfficialIdentitySourceType(source.source_type) }));
  const identitySources = [...input.identity_sources.map((source) => ({
    ...source,
    source_type: canonicalOfficialIdentitySourceType(source.source_type) ?? source.source_type,
  })), ...persistedIdentitySources]
    .filter((source, index, values) => values.findIndex((candidate) => candidate.url.toLowerCase() === source.url.toLowerCase()) === index)
    .slice(0, 30);
  return { ...input, aliases, identity_sources: identitySources };
}

async function researchWithTransientRetry(
  provider: ProductResearchProvider,
  input: ProductResearchInput,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TRANSIENT_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      return await provider.research(input);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= MAX_TRANSIENT_PROVIDER_ATTEMPTS || !isTransientProviderFailure(error)) throw error;
      agent3Debug("provider_retry", {
        catalog_product_id_present: true,
        attempt: attempt + 2,
        failure_kind: error instanceof ProductResearchUnavailableError ? error.failureKind : "unknown_provider_error",
      });
    }
  }
  throw lastError;
}

function isTransientProviderFailure(error: unknown) {
  if (!(error instanceof ProductResearchUnavailableError)) return true;
  return error.failureKind !== "provider_not_configured";
}

async function enrichWithSearchResults(
  input: ProductResearchInput,
  provider: ProductSearchProvider | null | undefined,
): Promise<ProductResearchInput> {
  if (!provider) return input;
  const queries = researchQueries(input);
  const batches = [] as Array<NonNullable<ProductResearchInput["search_results"]>>;
  for (const query of queries) {
    for (let attempt = 0; attempt < MAX_TRANSIENT_SEARCH_ATTEMPTS; attempt += 1) {
      try {
        batches.push(await provider.search({
          brand: input.brand_name,
          product_name: input.product_name,
          variant_name: input.variant_name,
          query,
        }));
        break;
      } catch (error) {
        agent3Debug("search_provider_failed", {
          provider_code: provider.providerCode,
          failure_kind: error instanceof Error ? error.message.slice(0, 120) : "unknown",
          attempt: attempt + 1,
        });
      }
    }
  }
  const results = deduplicateSearchResults(interleaveSearchResults(batches)).slice(0, 10);
  agent3Debug("search_provider_completed", {
    provider_code: provider.providerCode,
    research_mode: input.research_mode ?? "broad",
    query_count: queries.length,
    result_count: results.length,
  });
  // Search leads improve recall, but Agent3 web_search remains a bounded
  // fallback when application-provided leads do not cover the requested gaps.
  return { ...input, search_results: results };
}

function researchQueries(input: ProductResearchInput) {
  const identity = [input.brand_name, input.product_name, input.variant_name].filter(Boolean).join(" ");
  if (input.research_mode !== "gap_targeted") {
    return [
      identity,
      `${identity} 成分表 全成分 ingredients`,
      `${identity} 官方 功效 产品介绍 使用方法 注意事项`,
    ];
  }
  const focus = new Set(input.enrichment_focus ?? []);
  const queries: string[] = [];
  if (focus.has("ingredients")) queries.push(`${identity} 成分表 全成分 ingredients`);
  if (focus.has("usage") || focus.has("cautions")) queries.push(`${identity} 官方 使用方法 注意事项`);
  if (focus.has("claims")) queries.push(`${identity} 官方 功效 产品介绍`);
  if (focus.has("texture")) queries.push(`${identity} 质地 使用感`);
  if (focus.has("product_type") || focus.has("reliable_sources") || queries.length === 0) queries.push(`${identity} 官方 产品介绍`);
  return [...new Set(queries)].slice(0, 3);
}

function deduplicateSearchResults(results: NonNullable<ProductResearchInput["search_results"]>) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function interleaveSearchResults(batches: Array<NonNullable<ProductResearchInput["search_results"]>>) {
  const output = [] as NonNullable<ProductResearchInput["search_results"]>;
  const maximum = Math.max(0, ...batches.map((batch) => batch.length));
  for (let index = 0; index < maximum; index += 1) {
    for (const batch of batches) {
      const result = batch[index];
      if (result) output.push(result);
    }
  }
  return output;
}

function researchTerminal(
  outcome: "completed" | "partial" | "failed" | "existing_draft" | "verified_knowledge",
  draftCreated: boolean,
  rounds: number,
  remainingSections: readonly string[],
  addedFactCount: number,
) {
  agent3Debug("research_terminal", {
    outcome,
    draft_created: draftCreated,
    rounds,
    remaining_sections: remainingSections,
    added_fact_count: addedFactCount,
  });
}

async function hasSufficientVerifiedKnowledge(knowledge: KnowledgeRepository, catalogProductId: string) {
  const product = await knowledge.findVerifiedProduct(catalogProductId);
  if (!product) return false;
  const ingredients = await knowledge.listVerifiedProductIngredients(catalogProductId);
  return ingredients.length > 0;
}
