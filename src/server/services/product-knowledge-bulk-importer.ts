import { z } from "zod";

import { catalogProductImageUpdateSchema } from "@/schemas/catalog-product-image";
import {
  productResearchDraftCreateSchema,
  type ProductResearchDraft,
  type ProductResearchDraftCreate,
} from "@/schemas/product-research-draft";

const catalogIdentitySchema = z.object({
  brand_name: z.string().trim().min(1).max(120),
  product_name: z.string().trim().min(1).max(200),
  variant_name: z.string().trim().min(1).max(200).nullable(),
}).strict();

export const productKnowledgeBulkImportRecordSchema = productResearchDraftCreateSchema
  .omit({ catalog_product_id: true, research_version: true })
  .extend({
    catalog_product_id: z.uuid().nullable(),
    catalog_identity: catalogIdentitySchema.optional(),
    catalog_image: catalogProductImageUpdateSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.catalog_product_id) return;
    if (!record.catalog_identity) {
      context.addIssue({ code: "custom", path: ["catalog_identity"], message: "新 Catalog 产品必须提供 catalog_identity。" });
      return;
    }
    if (!sameIdentity(record.catalog_identity.brand_name, record.research_payload.identity.brand_name)
      || !sameIdentity(record.catalog_identity.product_name, record.research_payload.identity.product_name)
      || !sameNullableIdentity(record.catalog_identity.variant_name, record.research_payload.identity.variant_name)) {
      context.addIssue({ code: "custom", path: ["catalog_identity"], message: "catalog_identity 必须与 research_payload.identity 完全一致。" });
    }
    if (!record.research_payload.product_type.value) {
      context.addIssue({ code: "custom", path: ["research_payload", "product_type", "value"], message: "新 Catalog 产品必须提供 product_type.value。" });
    }
    if (record.research_payload.identity.confidence === null) {
      context.addIssue({ code: "custom", path: ["research_payload", "identity", "confidence"], message: "新 Catalog 产品必须提供 identity.confidence。" });
    }
    if (record.research_payload.identity.evidence_refs.length === 0) {
      context.addIssue({ code: "custom", path: ["research_payload", "identity", "evidence_refs"], message: "新 Catalog 产品必须以 identity.evidence_refs 指定 primary source。" });
    }
  });

export type ProductKnowledgeBulkImportRecord = z.infer<typeof productKnowledgeBulkImportRecordSchema>;

export type BulkImportDraftGateway = {
  createDraft(input: unknown): Promise<ProductResearchDraft>;
  getDraft(id: string): Promise<ProductResearchDraft | null>;
  getLatestUsableDraft(catalogProductId: string): Promise<ProductResearchDraft | null>;
  listDrafts(catalogProductId: string): Promise<ProductResearchDraft[]>;
  updateReviewStatus(id: string, input: unknown): Promise<ProductResearchDraft>;
};

export type BulkImportCatalogImageGateway = {
  update(catalogProductId: string, image: NonNullable<ProductKnowledgeBulkImportRecord["catalog_image"]>): Promise<void>;
};

export type BulkImportCatalogGateway = {
  findExact(identity: NonNullable<ProductKnowledgeBulkImportRecord["catalog_identity"]>): Promise<Array<{ id: string }>>;
  createBootstrap(input: {
    identity: NonNullable<ProductKnowledgeBulkImportRecord["catalog_identity"]>;
    barcode: string | null;
    product_type: NonNullable<ProductKnowledgeBulkImportRecord["research_payload"]["product_type"]["value"]>;
    confidence: number;
    primary_source: ProductKnowledgeBulkImportRecord["research_payload"]["sources"][number];
  }): Promise<{ id: string }>;
};

export type BulkImportResult = {
  line: number;
  catalog_product_id: string | null;
  status: "success" | "failed";
  reason?: string;
  draft_id?: string;
  research_version?: number;
  previous_draft_id?: string | null;
  image_updated?: boolean;
  catalog_product_created?: boolean;
};

export function validateBulkImportRecord(value: unknown) {
  return productKnowledgeBulkImportRecordSchema.safeParse(value);
}

export async function importBulkRecord(
  line: number,
  value: unknown,
  dependencies: {
    drafts: BulkImportDraftGateway;
    images: BulkImportCatalogImageGateway;
    catalog: BulkImportCatalogGateway;
  },
): Promise<BulkImportResult> {
  const parsed = validateBulkImportRecord(value);
  if (!parsed.success) {
    return {
      line,
      catalog_product_id: catalogProductId(value),
      status: "failed",
      reason: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    };
  }

  const record = parsed.data;
  const catalogImage = record.catalog_image;
  const draftInput = {
    research_payload: record.research_payload,
    overall_confidence: record.overall_confidence,
    created_by: record.created_by,
    research_model: record.research_model,
    research_run_id: record.research_run_id,
  };
  try {
    const catalog = await resolveCatalogProduct(record, dependencies.catalog);
    if (catalog.status === "failed") return { line, catalog_product_id: null, status: "failed", reason: catalog.reason };
    const previous = await dependencies.drafts.getLatestUsableDraft(catalog.catalog_product_id);
    const drafts = await dependencies.drafts.listDrafts(catalog.catalog_product_id);
    const researchVersion = Math.max(0, ...drafts.map((draft) => draft.research_version)) + 1;
    const created = await dependencies.drafts.createDraft({
      ...draftInput,
      catalog_product_id: catalog.catalog_product_id,
      research_version: researchVersion,
    } satisfies ProductResearchDraftCreate);
    const readBack = await dependencies.drafts.getDraft(created.id);
    if (!readBack || readBack.id !== created.id || readBack.research_version !== researchVersion) {
      return failedAfterCreate(line, catalog.catalog_product_id, created, previous, "新 draft read-back 未通过。");
    }

    if (previous) {
      const superseded = await dependencies.drafts.updateReviewStatus(previous.id, {
        status: "superseded",
        reviewed_by: null,
        reviewed_at: null,
      });
      if (superseded.status !== "superseded") {
        return failedAfterCreate(line, catalog.catalog_product_id, created, previous, "旧 usable draft 未能 supersede。");
      }
      const oldReadBack = await dependencies.drafts.getDraft(previous.id);
      if (oldReadBack?.status !== "superseded") {
        return failedAfterCreate(line, catalog.catalog_product_id, created, previous, "旧 draft supersede read-back 未通过。");
      }
    }

    if (catalogImage) {
      await dependencies.images.update(catalog.catalog_product_id, catalogImage);
    }

    return {
      line,
      catalog_product_id: catalog.catalog_product_id,
      status: "success",
      draft_id: created.id,
      research_version: created.research_version,
      previous_draft_id: previous?.id ?? null,
      image_updated: Boolean(catalogImage),
      catalog_product_created: catalog.created,
    };
  } catch (error) {
    return {
      line,
      catalog_product_id: record.catalog_product_id,
      status: "failed",
      reason: error instanceof Error ? error.message : "未知导入错误。",
    };
  }
}

export async function importBulkRecords(
  records: Array<{ line: number; value: unknown }>,
  dependencies: {
    drafts: BulkImportDraftGateway;
    images: BulkImportCatalogImageGateway;
    catalog: BulkImportCatalogGateway;
  },
) {
  const results: BulkImportResult[] = [];
  for (const record of records) {
    results.push(await importBulkRecord(record.line, record.value, dependencies));
  }
  return {
    success_count: results.filter((result) => result.status === "success").length,
    failed_count: results.filter((result) => result.status === "failed").length,
    results,
  };
}

async function resolveCatalogProduct(record: ProductKnowledgeBulkImportRecord, catalog: BulkImportCatalogGateway): Promise<
  | { status: "success"; catalog_product_id: string; created: boolean }
  | { status: "failed"; reason: string }
> {
  if (record.catalog_product_id) return { status: "success", catalog_product_id: record.catalog_product_id, created: false };
  const identity = record.catalog_identity!;
  const matches = await catalog.findExact(identity);
  if (matches.length > 1) return { status: "failed", reason: "ambiguous_catalog_identity" };
  if (matches.length === 1) return { status: "success", catalog_product_id: matches[0].id, created: false };
  const primarySourceId = record.research_payload.identity.evidence_refs[0];
  const primarySource = record.research_payload.sources.find((source) => source.source_id === primarySourceId);
  if (!primarySource) return { status: "failed", reason: "catalog_primary_source_not_found" };
  const productType = record.research_payload.product_type.value;
  if (!productType || record.research_payload.identity.confidence === null) {
    return { status: "failed", reason: "catalog_bootstrap_required_fields_missing" };
  }
  const created = await catalog.createBootstrap({
    identity,
    barcode: record.research_payload.identity.barcode,
    product_type: productType,
    confidence: record.research_payload.identity.confidence,
    primary_source: primarySource,
  });
  return { status: "success", catalog_product_id: created.id, created: true };
}

function catalogProductId(value: unknown) {
  return typeof value === "object" && value !== null && "catalog_product_id" in value
    && typeof value.catalog_product_id === "string" ? value.catalog_product_id : null;
}

function sameIdentity(left: string, right: string) { return normalizeIdentity(left) === normalizeIdentity(right); }
function sameNullableIdentity(left: string | null, right: string | null) { return left === null ? right === null : right !== null && sameIdentity(left, right); }
function normalizeIdentity(value: string) { return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]+/gu, ""); }

function failedAfterCreate(
  line: number,
  catalogProductId: string,
  created: ProductResearchDraft,
  previous: ProductResearchDraft | null,
  reason: string,
): BulkImportResult {
  return {
    line,
    catalog_product_id: catalogProductId,
    status: "failed",
    reason,
    draft_id: created.id,
    research_version: created.research_version,
    previous_draft_id: previous?.id ?? null,
  };
}
