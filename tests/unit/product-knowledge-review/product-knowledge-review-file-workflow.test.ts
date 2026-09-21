import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { catalogSeedInputSchema } from "@/schemas/catalog-seed";
import { productKnowledgeCurationInputSchema } from "@/schemas/product-knowledge-curation";
import { createProductKnowledgeReviewFileWorkflow } from "@/server/product-facts/product-knowledge-review-file-workflow";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("ProductKnowledgeReviewFileWorkflow", () => {
  it("prepares an unapproved review without overwriting it", async () => {
    const files = await fixtureFiles({ includeReview: false });
    const workflow = createProductKnowledgeReviewFileWorkflow();

    const report = await workflow.prepare({
      candidateFilePath: files.candidateFile,
    });

    expect(report).toMatchObject({
      action: "prepare",
      success: true,
      approved: false,
      review_file: path.join(files.directory, "sample.review.json"),
    });
    const review = JSON.parse(await readFile(report.review_file, "utf8"));
    expect(review.identity_review.approved).toBe(false);
    await expect(workflow.prepare({
      candidateFilePath: files.candidateFile,
    })).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("validates and compiles approved review to compatible Seed files", async () => {
    const files = await fixtureFiles();
    const outputDirectory = path.join(files.directory, "seed");
    const workflow = createProductKnowledgeReviewFileWorkflow();

    const validation = await workflow.validate({
      candidateFilePath: files.candidateFile,
      reviewFilePath: files.reviewFile,
    });
    const report = await workflow.compile({
      candidateFilePath: files.candidateFile,
      reviewFilePath: files.reviewFile,
      outputDirectory,
      productKey: "sample-product",
    });

    expect(validation).toMatchObject({ success: true, errors: [] });
    expect(report).toMatchObject({
      action: "compile",
      success: true,
      identity_file: path.join(outputDirectory, "sample-product.identity.json"),
      knowledge_file: path.join(outputDirectory, "sample-product.knowledge.json"),
      capabilities_compiled: 0,
    });
    const identity = JSON.parse(await readFile(report.identity_file, "utf8"));
    const knowledge = JSON.parse(await readFile(report.knowledge_file, "utf8"));
    expect(catalogSeedInputSchema.safeParse(identity).success).toBe(true);
    expect(productKnowledgeCurationInputSchema.safeParse(knowledge).success)
      .toBe(true);
    expect(knowledge.capabilities).toEqual([]);
  });
});

async function fixtureFiles(options: { includeReview?: boolean } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "beauty-os-review-"));
  temporaryDirectories.push(directory);
  const factFile = path.join(directory, "sample.facts.json");
  const candidateFile = path.join(directory, "sample.candidate.json");
  const reviewFile = path.join(directory, "sample.review.json");
  await writeFile(factFile, JSON.stringify(fact()), "utf8");
  await writeFile(candidateFile, JSON.stringify(candidate()), "utf8");
  if (options.includeReview !== false) {
    await writeFile(reviewFile, JSON.stringify(review()), "utf8");
  }
  return { directory, factFile, candidateFile, reviewFile };
}

function candidate() {
  return {
    schema_version: "knowledge-candidate/v0.1",
    candidate_id: "knowledge-candidate:open_beauty_facts:4006381333931:1",
    input_fact: {
      file_name: "sample.facts.json",
      fact_id: "open_beauty_facts:4006381333931:1",
      schema_version: "external-product-fact/v0.1",
      ingredients_text_reference: {
        json_path: "$.label.ingredients_text",
        present: true,
      },
    },
    identity_candidate: {
      brand_name: "Beauty OS",
      product_name: "Review Moisturizer",
      variant_name: "50 ml",
      barcode: "4006381333931",
    },
    classification_candidate: {
      category: "skincare",
      product_type: "moisturizer",
      mapping_source: "external_category_tag",
      matched_external_value: "en:moisturizers",
      confidence: 85,
    },
    decision_candidate: {
      primary_role: {
        value: "moisturizer",
        source: "product_type_mapping",
        confidence: 85,
      },
      capabilities: [],
    },
    warnings: [],
  };
}

function review() {
  return {
    schema_version: "product-knowledge-review/v0.1",
    candidate_id: candidate().candidate_id,
    seed_target: {
      catalog_product_id: "11111111-1111-4111-8111-111111111111",
      source_id: "22222222-2222-4222-8222-222222222222",
    },
    identity_review: {
      approved: true,
      brand_name_confirmed: true,
      product_name_confirmed: true,
      variant_confirmed: true,
      confidence: 95,
      notes: "包装已核对。",
    },
    classification_review: {
      product_type: { value: "moisturizer", approved: true },
    },
    decision_review: {
      primary_role: {
        value: "moisturizer",
        approved: true,
        confidence: 90,
        evidence_source: "包装标签与来源页面人工核对",
        notes: "主要护理角色已确认。",
      },
      capabilities: [],
    },
    review_metadata: {
      reviewed_by: "reviewer@example.com",
      reviewed_at: "2026-08-24T12:00:00+08:00",
    },
  };
}

function fact() {
  return {
    schema_version: "external-product-fact/v0.1",
    fact_id: "open_beauty_facts:4006381333931:1",
    identity: {
      brand_name: "Beauty OS",
      product_name: "Review Moisturizer",
      variant_name: "50 ml",
      barcode: "4006381333931",
      quantity: "50 ml",
    },
    label: {
      categories_tags: ["en:moisturizers"],
      ingredients_text: "Aqua, Glycerin",
    },
    media: { image_front_url: null, stored: false },
    source: {
      provider_code: "open_beauty_facts",
      source_type: "open_dataset",
      source_name: "Open Beauty Facts",
      source_url: "https://example.test/product/4006381333931",
      raw_record_id: "4006381333931",
      retrieved_at: "2026-08-24T04:00:00.000Z",
      modified_at: null,
      license: "ODbL; image terms apply",
      source_quality: 80,
    },
    warnings: [],
  };
}
