import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogSeedDryRunReport } from "@/schemas/catalog-seed";
import type { CatalogSeedDryRunChecker } from "@/server/catalog-seed/catalog-seed-dry-run";
import type { CatalogSeedService } from "@/server/services/catalog-seed-service";
import type { ProductKnowledgeCurationImportRunner } from "@/server/services/product-knowledge-curation-import-runner";
import {
  createProductKnowledgeSeedWorkflow,
  type ProductKnowledgeSeedFiles,
} from "@/server/services/product-knowledge-seed-workflow";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-24T00:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe("ProductKnowledgeSeedWorkflow", () => {
  it("validates a paired Seed without database dependencies", async () => {
    const files = await writePair();
    const workflow = createProductKnowledgeSeedWorkflow();

    const report = await workflow.run(files, { mode: "validate" });

    expect(report).toMatchObject({
      success: true,
      mode: "validate",
      catalog_product_id: catalogProductId,
      identity: { status: "validated", applied: false },
      knowledge: { status: "validated", applied: false },
    });
  });

  it("rejects a mismatched identity and knowledge pair", async () => {
    const files = await writePair({
      knowledge: {
        ...knowledgeInput(),
        catalog_product_id: "10000000-0000-4000-8000-000000000099",
      },
    });
    const workflow = createProductKnowledgeSeedWorkflow();

    const report = await workflow.run(files, { mode: "validate" });

    expect(report.success).toBe(false);
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "KNOWLEDGE_SEED_CATALOG_PRODUCT_ID_MISMATCH",
    }));
  });

  it("requires exactly one verified primary role", async () => {
    const files = await writePair({
      knowledge: { ...knowledgeInput(), roles: [] },
    });
    const workflow = createProductKnowledgeSeedWorkflow();

    const report = await workflow.run(files, { mode: "validate" });

    expect(report.success).toBe(false);
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "KNOWLEDGE_SEED_VERIFIED_PRIMARY_ROLE_REQUIRED",
    }));
  });

  it("rejects a verified capability without verified supporting evidence", async () => {
    const files = await writePair({
      knowledge: {
        ...knowledgeInput(),
        capabilities: [{
          capability_code: "hydration",
          status: "verified",
          confidence: 90,
          assessment_note: "Hydration",
          reviewed_at: timestamp,
          evidence: [],
        }],
      },
    });
    const workflow = createProductKnowledgeSeedWorkflow();

    const report = await workflow.run(files, { mode: "validate" });

    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "VERIFIED_CAPABILITY_MISSING_VERIFIED_SUPPORTING_EVIDENCE",
    }));
  });

  it("defers knowledge preview for a new Catalog during dry-run", async () => {
    const files = await writePair();
    const dependencies = dependenciesFor("new");
    const workflow = createProductKnowledgeSeedWorkflow(dependencies);

    const report = await workflow.run(files, { mode: "dry-run" });

    expect(report).toMatchObject({
      success: true,
      identity: { status: "new", applied: false },
      knowledge: { status: "preview_deferred", applied: false },
    });
    expect(dependencies.catalogService.apply).not.toHaveBeenCalled();
    expect(dependencies.curationRunner.run).not.toHaveBeenCalled();
  });

  it("previews knowledge diff when the Catalog already exists", async () => {
    const files = await writePair();
    const dependencies = dependenciesFor("existing");
    const workflow = createProductKnowledgeSeedWorkflow(dependencies);

    const report = await workflow.run(files, { mode: "dry-run" });

    expect(report).toMatchObject({
      success: true,
      identity: { status: "existing", applied: false },
      knowledge: { status: "ready", applied: false },
    });
    expect(dependencies.curationRunner.run).toHaveBeenCalledWith(
      files.knowledgeFilePath,
      { mode: "dry-run" },
    );
  });

  it("applies identity before decision knowledge and reports both commits", async () => {
    const files = await writePair();
    const dependencies = dependenciesFor("new");
    const workflow = createProductKnowledgeSeedWorkflow(dependencies);

    const report = await workflow.run(files, { mode: "apply" });

    expect(report).toMatchObject({
      success: true,
      identity: { status: "applied", applied: true },
      knowledge: { status: "applied", applied: true },
    });
    expect(
      vi.mocked(dependencies.catalogService.apply).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.curationRunner.run).mock.invocationCallOrder[0]!,
    );
  });

  it("exposes a recoverable partial state when curation apply fails", async () => {
    const files = await writePair();
    const dependencies = dependenciesFor("new", false);
    const workflow = createProductKnowledgeSeedWorkflow(dependencies);

    const report = await workflow.run(files, { mode: "apply" });

    expect(report).toMatchObject({
      success: false,
      identity: { status: "applied", applied: true },
      knowledge: { status: "invalid", applied: false },
      errors: [expect.objectContaining({ code: "CURATION_WRITE_FAILED" })],
    });
  });
});

function dependenciesFor(
  status: "new" | "existing",
  curationSuccess = true,
) {
  const catalogDryRun = {
    run: vi.fn().mockResolvedValue(catalogReport(status)),
  } satisfies CatalogSeedDryRunChecker;
  const catalogService = {
    apply: vi.fn().mockResolvedValue({
      receipt: {
        outcome: status === "new" ? "created" : "existing",
        catalog_product_id: catalogProductId,
        source_id: sourceId,
        source_created: status === "new",
        catalog_product_created: status === "new",
        status: "verified",
      },
      readback: {},
      warnings: [],
    }),
  } as unknown as CatalogSeedService;
  const curationRunner = {
    run: vi.fn().mockImplementation((filePath, options) => Promise.resolve(
      curationSuccess
        ? {
        success: true,
        mode: options?.mode ?? "dry-run",
        file_path: filePath,
        applied: options?.mode === "apply",
        product_identity: null,
        changes: { roles: [], capabilities: [], evidence: [] },
        warnings: [],
        errors: [],
      }
      : {
        success: false,
        mode: "apply",
        file_path: "knowledge.json",
        applied: false,
        product_identity: null,
        changes: { roles: [], capabilities: [], evidence: [] },
        warnings: [],
        errors: [{
          stage: "apply",
          code: "CURATION_WRITE_FAILED",
          message: "write failed",
        }],
      },
    )),
  } as unknown as ProductKnowledgeCurationImportRunner;

  return { catalogDryRun, catalogService, curationRunner };
}

function catalogReport(
  status: "new" | "existing",
): CatalogSeedDryRunReport {
  return {
    report_version: "catalog-seed-dry-run/v0.1",
    status,
    new_products: status === "new" ? [productSummary()] : [],
    existing_products: status === "existing" ? [productSummary()] : [],
    conflicts: [],
    warnings: [],
    errors: [],
  };
}

function productSummary() {
  return {
    catalog_product_id: catalogProductId,
    brand_name: "Beauty OS",
    product_name: "Seed Moisturizer",
    variant_name: null,
    barcode: null,
    category: "skincare" as const,
    subcategory: "face_care" as const,
    product_type: "moisturizer" as const,
  };
}

async function writePair(overrides: {
  identity?: unknown;
  knowledge?: unknown;
} = {}): Promise<ProductKnowledgeSeedFiles> {
  const directory = await mkdtemp(path.join(tmpdir(), "beauty-os-seed-"));
  temporaryDirectories.push(directory);
  const identityFilePath = path.join(directory, "seed.identity.json");
  const knowledgeFilePath = path.join(directory, "seed.knowledge.json");
  await Promise.all([
    writeFile(
      identityFilePath,
      JSON.stringify(overrides.identity ?? identityInput()),
      "utf8",
    ),
    writeFile(
      knowledgeFilePath,
      JSON.stringify(overrides.knowledge ?? knowledgeInput()),
      "utf8",
    ),
  ]);
  return { productKey: "seed", identityFilePath, knowledgeFilePath };
}

function identityInput() {
  return {
    schema_version: "catalog-seed/v0.1",
    catalog_product_id: catalogProductId,
    source: {
      source_id: sourceId,
      source_type: "official_brand",
      name: "Official source",
      source_url: "https://example.com/product",
      license_note: "Official product facts",
      retrieved_at: timestamp,
    },
    identity: {
      brand_name: "Beauty OS",
      product_name: "Seed Moisturizer",
      variant_name: null,
      barcode: null,
      category: "skincare",
      subcategory: "face_care",
      product_type: "moisturizer",
      confidence: 95,
      status: "verified",
    },
  };
}

function knowledgeInput() {
  return {
    schema_version: "product-knowledge-curation/v0.1",
    catalog_product_id: catalogProductId,
    roles: [{
      care_role_code: "moisturizer",
      assignment_kind: "primary",
      status: "verified",
      confidence: 95,
      assessment_note: "Human-reviewed primary role",
      source_locator: "https://example.com/product",
      reviewed_at: timestamp,
    }],
    capabilities: [],
  };
}
