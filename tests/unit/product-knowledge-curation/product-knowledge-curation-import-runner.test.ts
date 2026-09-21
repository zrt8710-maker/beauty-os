import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProductKnowledgeSnapshot } from "@/schemas/product-knowledge";
import { createProductKnowledgeCurationImportRunner } from "@/server/services/product-knowledge-curation-import-runner";
import type { ProductKnowledgeCurationService } from "@/server/services/product-knowledge-curation-service";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const roleAssignmentId = "20000000-0000-4000-8000-000000000001";
const capabilityAssignmentId = "30000000-0000-4000-8000-000000000001";
const evidenceId = "40000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-24T00:00:00.000Z";
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe("ProductKnowledgeCurationImportRunner", () => {
  it("previews and applies a valid file with declared-only changes", async () => {
    const filePath = await writeJson(validInput());
    const { service, preview, curate } = setupService();
    const runner = createProductKnowledgeCurationImportRunner(service);

    const report = await runner.run(filePath, { mode: "apply" });

    expect(report.success).toBe(true);
    expect(report.applied).toBe(true);
    expect(report.product_identity).toMatchObject({
      catalog_product_id: catalogProductId,
      product_name: "Curation Serum",
    });
    expect(report.changes.roles.map((change) => [
      change.care_role_code,
      change.change,
    ])).toEqual([
      ["moisturizer", "create"],
      ["hydration", "update"],
    ]);
    expect(report.changes.capabilities).toEqual([
      expect.objectContaining({
        capability_code: "hydration",
        change: "unchanged",
      }),
    ]);
    expect(report.changes.evidence).toEqual([
      expect.objectContaining({
        capability_code: "hydration",
        change: "replace",
        before_count: 1,
        after_count: 1,
      }),
    ]);
    expect(report.changes.roles.some(
      (change) => change.care_role_code === "cleanser",
    )).toBe(false);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(curate).toHaveBeenCalledTimes(1);
    expect(preview.mock.invocationCallOrder[0]).toBeLessThan(
      curate.mock.invocationCallOrder[0]!,
    );
  });

  it("returns schema errors without calling the service", async () => {
    const filePath = await writeJson({
      ...validInput(),
      catalog_product_id: "not-a-uuid",
    });
    const { service, preview, curate } = setupService();
    const runner = createProductKnowledgeCurationImportRunner(service);

    const report = await runner.run(filePath, { mode: "apply" });

    expect(report).toMatchObject({
      success: false,
      applied: false,
      product_identity: null,
      errors: [expect.objectContaining({
        stage: "schema",
        code: "CURATION_SCHEMA_INVALID",
      })],
    });
    expect(preview).not.toHaveBeenCalled();
    expect(curate).not.toHaveBeenCalled();
  });

  it("returns validator errors before preview or write", async () => {
    const input = validInput();
    input.roles = [];
    input.capabilities[0]!.evidence = [];
    const filePath = await writeJson(input);
    const { service, preview, curate } = setupService();
    const runner = createProductKnowledgeCurationImportRunner(service);

    const report = await runner.run(filePath, { mode: "apply" });

    expect(report).toMatchObject({
      success: false,
      applied: false,
      errors: [expect.objectContaining({
        stage: "validator",
        code: "VERIFIED_CAPABILITY_MISSING_VERIFIED_SUPPORTING_EVIDENCE",
      })],
    });
    expect(preview).not.toHaveBeenCalled();
    expect(curate).not.toHaveBeenCalled();
  });

  it("defaults to dry-run and never invokes curate", async () => {
    const filePath = await writeJson(validInput());
    const { service, preview, curate } = setupService();
    const runner = createProductKnowledgeCurationImportRunner(service);

    const report = await runner.run(filePath);

    expect(report).toMatchObject({
      success: true,
      mode: "dry-run",
      applied: false,
      errors: [],
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(curate).not.toHaveBeenCalled();
  });

  it("returns a failure report when apply service fails", async () => {
    const filePath = await writeJson(validInput());
    const applyError = Object.assign(new Error("write failed"), {
      code: "PRODUCT_KNOWLEDGE_CURATION_WRITE_FAILED",
      writeCommitted: false,
    });
    const { service, curate } = setupService({ applyError });
    const runner = createProductKnowledgeCurationImportRunner(service);

    const report = await runner.run(filePath, { mode: "apply" });

    expect(report).toMatchObject({
      success: false,
      mode: "apply",
      applied: false,
      product_identity: {
        catalog_product_id: catalogProductId,
      },
      errors: [{
        stage: "apply",
        code: "PRODUCT_KNOWLEDGE_CURATION_WRITE_FAILED",
        message: "write failed",
      }],
    });
    expect(report.changes.roles).not.toEqual([]);
    expect(curate).toHaveBeenCalledTimes(1);
  });

  it("reports malformed JSON without calling the service", async () => {
    const filePath = await writeText("{ not-json");
    const { service, preview, curate } = setupService();
    const runner = createProductKnowledgeCurationImportRunner(service);

    const report = await runner.run(filePath, { mode: "apply" });

    expect(report).toMatchObject({
      success: false,
      errors: [expect.objectContaining({
        stage: "json",
        code: "CURATION_JSON_INVALID",
      })],
    });
    expect(preview).not.toHaveBeenCalled();
    expect(curate).not.toHaveBeenCalled();
  });
});

function setupService(options: { applyError?: Error } = {}) {
  const snapshot = productKnowledgeSnapshot();
  const preview = vi.fn().mockResolvedValue({ snapshot, warnings: [] });
  const curate = options.applyError
    ? vi.fn().mockRejectedValue(options.applyError)
    : vi.fn().mockResolvedValue({
      receipt: {
        catalog_product_id: catalogProductId,
        role_assignment_ids: {
          moisturizer: "20000000-0000-4000-8000-000000000002",
          hydration: roleAssignmentId,
        },
        capability_assignment_ids: {
          hydration: capabilityAssignmentId,
        },
        evidence_counts: { hydration: 1 },
      },
      snapshot,
      warnings: [],
    });
  const service = { preview, curate } as ProductKnowledgeCurationService;
  return { service, preview, curate };
}

function validInput() {
  return {
    schema_version: "product-knowledge-curation/v0.1",
    catalog_product_id: catalogProductId,
    roles: [
      {
        care_role_code: "moisturizer",
        assignment_kind: "primary",
        status: "verified",
        confidence: 95,
        assessment_note: "Primary moisturizer role",
        source_locator: "https://example.com/product",
        reviewed_at: timestamp,
      },
      {
        care_role_code: "hydration",
        assignment_kind: "secondary",
        status: "verified",
        confidence: 85,
        assessment_note: "Updated hydration role",
        source_locator: "https://example.com/product",
        reviewed_at: timestamp,
      },
    ],
    capabilities: [
      {
        capability_code: "hydration",
        status: "verified",
        confidence: 90,
        assessment_note: "Hydration assessment",
        reviewed_at: timestamp,
        evidence: [
          {
            evidence_type: "official_product_description",
            direction: "supports",
            evidence_note: "New supporting evidence",
            source_locator: "https://example.com/product",
            confidence: 90,
            review_status: "verified",
          },
        ],
      },
    ],
  };
}

function productKnowledgeSnapshot(): ProductKnowledgeSnapshot {
  return {
    identity: {
      catalog_product_id: catalogProductId,
      brand_name: "Beauty OS",
      product_name: "Curation Serum",
      variant_name: null,
      barcode: null,
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      primary_source_id: "50000000-0000-4000-8000-000000000001",
      identity_confidence: 98,
      catalog_status: "verified",
      created_at: timestamp,
      updated_at: timestamp,
    },
    care_roles: [
      {
        assignment_id: roleAssignmentId,
        care_role_code: "hydration",
        display_name: "Hydration",
        definition: "Hydration step",
        definition_version: 1,
        assignment_kind: "secondary",
        status: "candidate",
        confidence: null,
        assessment_note: "Old hydration role",
        source_locator: "https://example.com/old",
        reviewed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        assignment_id: "20000000-0000-4000-8000-000000000003",
        care_role_code: "cleanser",
        display_name: "Cleanser",
        definition: "Unmentioned role",
        definition_version: 1,
        assignment_kind: "secondary",
        status: "candidate",
        confidence: null,
        assessment_note: null,
        source_locator: null,
        reviewed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    capabilities: [
      {
        product_capability_id: capabilityAssignmentId,
        capability_code: "hydration",
        display_name: "Hydration",
        definition: "Hydration capability",
        definition_version: 1,
        status: "verified",
        confidence: 90,
        assessment_note: "Hydration assessment",
        reviewed_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
        evidence_summary: {
          total: 1,
          by_direction: { supports: 1, contradicts: 0 },
          by_review_status: { verified: 1, candidate: 0, rejected: 0 },
        },
        evidence: [
          {
            evidence_id: evidenceId,
            evidence_type: "manual_curation",
            direction: "supports",
            evidence_note: "Old supporting evidence",
            source_locator: null,
            confidence: 80,
            review_status: "verified",
            created_at: timestamp,
          },
        ],
      },
      {
        product_capability_id: "30000000-0000-4000-8000-000000000002",
        capability_code: "barrier_support",
        display_name: "Barrier support",
        definition: "Unmentioned capability",
        definition_version: 1,
        status: "candidate",
        confidence: null,
        assessment_note: null,
        reviewed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
        evidence_summary: {
          total: 0,
          by_direction: { supports: 0, contradicts: 0 },
          by_review_status: { verified: 0, candidate: 0, rejected: 0 },
        },
        evidence: [],
      },
    ],
  };
}

async function writeJson(input: unknown) {
  return writeText(JSON.stringify(input));
}

async function writeText(contents: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "beauty-os-curation-"));
  tempDirectories.push(directory);
  const filePath = path.join(directory, "curation.json");
  await writeFile(filePath, contents, "utf8");
  return filePath;
}
