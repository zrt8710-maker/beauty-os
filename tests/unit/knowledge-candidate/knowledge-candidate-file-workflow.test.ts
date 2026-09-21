import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createKnowledgeCandidateFileWorkflow } from "@/server/product-facts/knowledge-candidate-file-workflow";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe("KnowledgeCandidateFileWorkflow", () => {
  it("converts a facts file to a neighboring candidate file", async () => {
    const directory = await temporaryDirectory();
    const inputFile = path.join(directory, "4006381333931.facts.json");
    await writeFile(inputFile, JSON.stringify(fact()), "utf8");
    const workflow = createKnowledgeCandidateFileWorkflow();

    const report = await workflow.run({ inputFilePath: inputFile });

    expect(report).toMatchObject({
      success: true,
      input_file: inputFile,
      output_file: path.join(directory, "4006381333931.candidate.json"),
    });
    const candidate = JSON.parse(await readFile(report.output_file, "utf8"));
    expect(candidate).toMatchObject({
      input_fact: {
        file_name: "4006381333931.facts.json",
        ingredients_text_reference: {
          json_path: "$.label.ingredients_text",
          present: true,
        },
      },
      classification_candidate: { product_type: "cleanser" },
      decision_candidate: {
        primary_role: { value: "cleanser" },
        capabilities: [],
      },
    });
    expect(candidate).not.toHaveProperty("verified");
  });
});

function fact() {
  return {
    schema_version: "external-product-fact/v0.1",
    fact_id: "open_beauty_facts:4006381333931:1787529600",
    identity: {
      brand_name: "Beauty OS",
      product_name: "Candidate Cleanser",
      variant_name: "100 ml",
      barcode: "4006381333931",
      quantity: "100 ml",
    },
    label: {
      categories_tags: ["en:facial-cleansers"],
      ingredients_text: "Aqua, Glycerin",
    },
    media: { image_front_url: null, stored: false },
    source: {
      provider_code: "open_beauty_facts",
      source_type: "open_dataset",
      source_name: "Open Beauty Facts",
      source_url:
      "https://example.test/product/4006381333931",
      raw_record_id: "4006381333931",
      retrieved_at: "2026-08-24T03:00:00.000Z",
      modified_at: "2026-08-24T00:00:00.000Z",
      license: "ODbL; image terms apply",
      source_quality: 80,
    },
    warnings: [],
  };
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "beauty-os-candidate-"));
  temporaryDirectories.push(directory);
  return directory;
}
