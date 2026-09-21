import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import {
  productKnowledgeSnapshotSchema,
  type ProductCapabilityEvidence,
  type ProductKnowledgeCapability,
  type ProductKnowledgeCareRole,
  type ProductKnowledgeSnapshot,
} from "@/schemas/product-knowledge";

type CatalogProductRow =
  Database["public"]["Tables"]["catalog_products"]["Row"];
type CareRoleRow = Database["public"]["Tables"]["care_roles"]["Row"];
type CatalogProductCareRoleRow =
  Database["public"]["Tables"]["catalog_product_care_roles"]["Row"];
type CapabilityRow = Database["public"]["Tables"]["capabilities"]["Row"];
type CatalogProductCapabilityRow =
  Database["public"]["Tables"]["catalog_product_capabilities"]["Row"];
type ProductCapabilityEvidenceRow =
  Database["public"]["Tables"]["product_capability_evidence"]["Row"];

type CareRoleWithTaxonomyRow = CatalogProductCareRoleRow & {
  care_role: Pick<
    CareRoleRow,
    "code" | "display_name" | "definition" | "definition_version"
  >;
};

type CapabilityWithEvidenceRow = CatalogProductCapabilityRow & {
  capability: Pick<
    CapabilityRow,
    "code" | "display_name" | "definition" | "definition_version"
  >;
  evidence: ProductCapabilityEvidenceRow[];
};

export type ProductKnowledgeRepository = {
  findByCatalogProductId(
    catalogProductId: string,
    timing?: { requestId: string; queryKind?: string },
  ): Promise<ProductKnowledgeSnapshot | null>;
  findByCatalogProductIds?(
    catalogProductIds: string[],
    timing?: { requestId: string; queryKind?: string },
  ): Promise<ReadonlyMap<string, ProductKnowledgeSnapshot>>;
};

const careRoleSelection = [
  "*",
  "care_role:care_roles!catalog_product_care_roles_care_role_code_fkey(code, display_name, definition, definition_version)",
].join(", ");

const capabilitySelection = [
  "*",
  "capability:capabilities!catalog_product_capabilities_capability_code_fkey(code, display_name, definition, definition_version)",
  "evidence:product_capability_evidence(*)",
].join(", ");

export function createProductKnowledgeRepository(
  supabase: SupabaseClient<Database>,
): ProductKnowledgeRepository {
  async function findByCatalogProductIds(
    catalogProductIds: string[],
    timing?: { requestId: string; queryKind?: string },
  ) {
    const ids = [...new Set(catalogProductIds)];
    if (ids.length === 0) return new Map<string, ProductKnowledgeSnapshot>();
    const startedAt = Date.now();
    const [identityResult, careRoleResult, capabilityResult] = await Promise.all([
      supabase.from("catalog_products").select("*").in("id", ids).eq("status", "verified"),
      supabase.from("catalog_product_care_roles").select(careRoleSelection).in("catalog_product_id", ids),
      supabase.from("catalog_product_capabilities").select(capabilitySelection).in("catalog_product_id", ids),
    ]);
    logTodayBatchQueryTiming(timing, timing?.queryKind ?? "formal_knowledge_batch", ids.length, startedAt, !identityResult.error && !careRoleResult.error && !capabilityResult.error);
    if (identityResult.error || careRoleResult.error || capabilityResult.error) {
      throw new Error("PRODUCT_KNOWLEDGE_READ_FAILED", {
        cause: identityResult.error ?? careRoleResult.error ?? capabilityResult.error,
      });
    }

    const identities = (identityResult.data ?? []) as CatalogProductRow[];
    const roles = (careRoleResult.data ?? []) as unknown as CareRoleWithTaxonomyRow[];
    const capabilities = (capabilityResult.data ?? []) as unknown as CapabilityWithEvidenceRow[];
    return new Map(identities.map((identity) => [identity.id, productKnowledgeSnapshotSchema.parse({
      identity: toIdentity(identity),
      care_roles: roles.filter((row) => row.catalog_product_id === identity.id).map(toCareRole).sort(compareCareRoles),
      capabilities: capabilities.filter((row) => row.catalog_product_id === identity.id).map(toCapability).sort((left, right) => left.capability_code.localeCompare(right.capability_code)),
    })]));
  }

  return {
    async findByCatalogProductId(catalogProductId, timing) {
      const identityStartedAt = Date.now();
      const identityResult = await supabase
        .from("catalog_products")
        .select("*")
        .eq("id", catalogProductId)
        .eq("status", "verified")
        .maybeSingle();
      logTodayQueryTiming(timing, timing?.queryKind ?? "formal_catalog_identity", catalogProductId, identityStartedAt, !identityResult.error);

      if (identityResult.error) {
        throw new Error("PRODUCT_KNOWLEDGE_READ_FAILED", {
          cause: identityResult.error,
        });
      }

      if (!identityResult.data) {
        return null;
      }

      const careRoleStartedAt = Date.now();
      const careRoleQuery = supabase
        .from("catalog_product_care_roles")
        .select(careRoleSelection)
        .eq("catalog_product_id", catalogProductId);
      const capabilityStartedAt = Date.now();
      const capabilityQuery = supabase
        .from("catalog_product_capabilities")
        .select(capabilitySelection)
        .eq("catalog_product_id", catalogProductId);
      const [careRoleResult, capabilityResult] = await Promise.all([
        careRoleQuery,
        capabilityQuery,
      ]);
      logTodayQueryTiming(timing, "care_role", catalogProductId, careRoleStartedAt, !careRoleResult.error);
      logTodayQueryTiming(timing, "capability", catalogProductId, capabilityStartedAt, !capabilityResult.error);

      if (careRoleResult.error || capabilityResult.error) {
        throw new Error("PRODUCT_KNOWLEDGE_READ_FAILED", {
          cause: careRoleResult.error ?? capabilityResult.error,
        });
      }

      const identity = identityResult.data as CatalogProductRow;
      const careRoleRows = (careRoleResult.data ?? []) as unknown as
        CareRoleWithTaxonomyRow[];
      const capabilityRows = (capabilityResult.data ?? []) as unknown as
        CapabilityWithEvidenceRow[];

      return productKnowledgeSnapshotSchema.parse({
        identity: toIdentity(identity),
        care_roles: careRoleRows.map(toCareRole).sort(compareCareRoles),
        capabilities: capabilityRows
          .map(toCapability)
          .sort((left, right) =>
            left.capability_code.localeCompare(right.capability_code)),
      });
    },
    findByCatalogProductIds,
  };
}

function logTodayQueryTiming(timing: { requestId: string; queryKind?: string } | undefined, queryKind: string, catalogProductId: string, startedAt: number, success: boolean) {
  if (process.env.NODE_ENV !== "development" || !timing) return;
  console.info("[today-supabase]", { requestId: timing.requestId, queryKind, catalogProductId: catalogProductId.slice(0, 8), durationMs: Date.now() - startedAt, success });
}

function logTodayBatchQueryTiming(timing: { requestId: string; queryKind?: string } | undefined, queryKind: string, catalogProductCount: number, startedAt: number, success: boolean) {
  if (process.env.NODE_ENV !== "development" || !timing) return;
  console.info("[today-supabase]", { requestId: timing.requestId, queryKind, catalogProductCount, durationMs: Date.now() - startedAt, success });
}

function toIdentity(row: CatalogProductRow) {
  return {
    catalog_product_id: row.id,
    brand_name: row.brand_name,
    product_name: row.product_name,
    variant_name: row.variant_name,
    barcode: row.barcode,
    category: row.category,
    subcategory: row.subcategory,
    product_type: row.product_type,
    primary_source_id: row.primary_source_id,
    identity_confidence: row.confidence,
    catalog_status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toCareRole(row: CareRoleWithTaxonomyRow): ProductKnowledgeCareRole {
  return {
    assignment_id: row.id,
    care_role_code: row.care_role.code,
    display_name: row.care_role.display_name,
    definition: row.care_role.definition,
    definition_version: row.care_role.definition_version,
    assignment_kind: row.assignment_kind as ProductKnowledgeCareRole["assignment_kind"],
    status: row.status as ProductKnowledgeCareRole["status"],
    confidence: row.confidence,
    assessment_note: row.assessment_note,
    source_locator: row.source_locator,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toCapability(
  row: CapabilityWithEvidenceRow,
): ProductKnowledgeCapability {
  const evidence = row.evidence.map(toEvidence).sort((left, right) =>
    left.created_at.localeCompare(right.created_at)
      || left.evidence_id.localeCompare(right.evidence_id));

  return {
    product_capability_id: row.id,
    capability_code: row.capability.code,
    display_name: row.capability.display_name,
    definition: row.capability.definition,
    definition_version: row.capability.definition_version,
    status: row.status as ProductKnowledgeCapability["status"],
    confidence: row.confidence,
    assessment_note: row.assessment_note,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    evidence_summary: summarizeEvidence(evidence),
    evidence,
  };
}

function toEvidence(
  row: ProductCapabilityEvidenceRow,
): ProductCapabilityEvidence {
  return {
    evidence_id: row.id,
    evidence_type: row.evidence_type as ProductCapabilityEvidence["evidence_type"],
    direction: row.direction as ProductCapabilityEvidence["direction"],
    evidence_note: row.evidence_note,
    source_locator: row.source_locator,
    confidence: row.confidence,
    review_status: row.review_status as ProductCapabilityEvidence["review_status"],
    created_at: row.created_at,
  };
}

function summarizeEvidence(evidence: ProductCapabilityEvidence[]) {
  return {
    total: evidence.length,
    by_direction: {
      supports: evidence.filter((item) => item.direction === "supports").length,
      contradicts: evidence.filter((item) => item.direction === "contradicts").length,
    },
    by_review_status: {
      verified: evidence.filter((item) => item.review_status === "verified").length,
      candidate: evidence.filter((item) => item.review_status === "candidate").length,
      rejected: evidence.filter((item) => item.review_status === "rejected").length,
    },
  };
}

function compareCareRoles(
  left: ProductKnowledgeCareRole,
  right: ProductKnowledgeCareRole,
) {
  const kindDifference = Number(left.assignment_kind === "secondary")
    - Number(right.assignment_kind === "secondary");
  return kindDifference
    || left.care_role_code.localeCompare(right.care_role_code);
}
