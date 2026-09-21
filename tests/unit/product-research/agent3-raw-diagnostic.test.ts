import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDevelopmentAgent3RawDiagnosticCapture } from "@/server/product-research/agent3-raw-diagnostic";

const directories: string[] = [];
const input = {
  catalog_product_id: "10000000-0000-4000-8000-000000000001",
  brand_name: "HFP",
  product_name: "果酸毛孔净透精华水",
  variant_name: null,
  barcode: null,
  aliases: ["HomeFacialPro"],
  identity_sources: [],
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Agent3 development raw diagnostics", () => {
  it("keeps exact final output and later composition outcome without secrets", async () => {
    const directory = await temporaryDirectory();
    const diagnostics = createDevelopmentAgent3RawDiagnosticCapture({ enabled: true, directory, now: () => new Date("2026-08-28T00:00:00.000Z"), idFactory: () => "run-a" });
    const raw = '{\n  "unmodified": true\n}';
    const id = await diagnostics.recordProviderCompletion(input, {
      model: "doubao-seed-2.1-turbo",
      startedAt: new Date("2026-08-28T00:00:00.000Z"),
      completedAt: new Date("2026-08-28T00:00:01.000Z"),
      researchRunId: "response_1",
      rawFinalOutput: raw,
      transportValidation: { json_parse_success: true, schema_success: true, issues: [] },
      confidenceDiagnostic: {
        raw_confidence: 72,
        cap: 55,
        cap_reason: "source_not_reconciled",
        final_confidence: 55,
        matched_source_count: 2,
        unmatched_source_count: 1,
        source_class_counts: { exact_product: 2 },
        source_classifications: [{
          source_id: "source_1",
          source_class: "exact_product",
          source_priority: "official_product",
          classifier_reason: "canonical_name_match",
          matched_name_or_alias: "果酸毛孔净透精华水",
          observed_variant_markers: [],
          brand_owned_domain: true,
        }],
        section_trust: {
          claims: { raw_confidence: 80, cap: 55, cap_reason: "source_not_reconciled", final_confidence: 55 },
        },
      },
    });
    await diagnostics.recordOutcome(id, { schema_success: false, failure_kind: "schema_error", draft_created: false });

    const file = (await readdir(directory)).find((name) => name.endsWith(".json"));
    const stored = JSON.parse(await readFile(path.join(directory, file ?? ""), "utf8"));
    expect(stored.raw_final_output).toBe(raw);
    expect(stored).toMatchObject({
      research_run_id: "response_1",
      model: "doubao-seed-2.1-turbo",
      raw_confidence: 72,
      cap: 55,
      cap_reason: "source_not_reconciled",
      final_confidence: 55,
      matched_source_count: 2,
      unmatched_source_count: 1,
      source_class_counts: { exact_product: 2 },
      source_classifications: [expect.objectContaining({ source_id: "source_1", classifier_reason: "canonical_name_match" })],
      section_trust: { claims: { cap_reason: "source_not_reconciled" } },
      composition: { schema_success: false, failure_kind: "schema_error", draft_created: false },
    });
    expect(JSON.stringify(stored)).not.toContain("Authorization");
    expect(JSON.stringify(stored)).not.toContain("VOLCENGINE_AGENT_PLAN_KEY");
  });

  it("retains only the configured most recent records", async () => {
    const directory = await temporaryDirectory();
    let tick = 0;
    const diagnostics = createDevelopmentAgent3RawDiagnosticCapture({ enabled: true, directory, maxRuns: 2, now: () => new Date(++tick * 1000), idFactory: () => `run-${tick}` });
    for (let index = 0; index < 3; index += 1) {
      await diagnostics.recordProviderCompletion(input, {
        model: "doubao-seed-2.1-turbo", startedAt: new Date(), completedAt: new Date(), researchRunId: `response-${index}`,
        rawFinalOutput: `{${index}}`, transportValidation: { json_parse_success: true, schema_success: true, issues: [] },
      });
    }
    expect((await readdir(directory)).filter((name) => name.endsWith(".json"))).toHaveLength(2);
  });

  it("does nothing outside development diagnostics", async () => {
    const directory = await temporaryDirectory();
    const diagnostics = createDevelopmentAgent3RawDiagnosticCapture({ enabled: false, directory });
    await diagnostics.recordProviderCompletion(input, {
      model: "doubao-seed-2.1-turbo", startedAt: new Date(), completedAt: new Date(), researchRunId: null,
      rawFinalOutput: "{}", transportValidation: { json_parse_success: true, schema_success: true, issues: [] },
    });
    expect(await readdir(directory)).toEqual([]);
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "beauty-os-agent3-diagnostic-"));
  directories.push(directory);
  return directory;
}
