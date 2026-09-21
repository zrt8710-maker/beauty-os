import "server-only";

import { mkdir, readdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ProductResearchInput } from "@/schemas/product-research";

export type Agent3TransportDiagnostic = {
  json_parse_success: boolean;
  schema_success: boolean;
  issues: Array<{ path: string; code: string; message: string }>;
};

export type Agent3ConfidenceDiagnostic = {
  raw_confidence: number | null;
  cap: number | null;
  cap_reason: string | null;
  final_confidence: number | null;
  matched_source_count: number;
  unmatched_source_count: number;
  source_class_counts: Record<string, number>;
  source_classifications: Array<{
    source_id: string;
    source_class: string;
    source_priority: string;
    classifier_reason: string;
    matched_name_or_alias: string | null;
    observed_variant_markers: string[];
    brand_owned_domain: boolean;
  }>;
  section_trust: Record<string, {
    raw_confidence: number;
    cap: number;
    cap_reason: string;
    final_confidence: number;
  }>;
};

type DiagnosticRecord = {
  diagnostic_id: string;
  research_run_id: string | null;
  catalog_product_id: string;
  model: string;
  started_at: string;
  completed_at: string;
  input_identity: Pick<ProductResearchInput, "brand_name" | "product_name" | "variant_name" | "barcode" | "aliases">;
  raw_final_output: string | null;
  transport_validation: Agent3TransportDiagnostic;
  raw_confidence: number | null;
  cap: number | null;
  cap_reason: string | null;
  final_confidence: number | null;
  matched_source_count: number;
  unmatched_source_count: number;
  source_class_counts: Record<string, number>;
  source_classifications: Agent3ConfidenceDiagnostic["source_classifications"];
  section_trust: Agent3ConfidenceDiagnostic["section_trust"];
  composition: { schema_success: boolean | null; failure_kind: string | null; draft_created: boolean | null };
};

export type Agent3RawDiagnosticCapture = {
  recordProviderCompletion(input: ProductResearchInput, detail: {
    model: string;
    startedAt: Date;
    completedAt: Date;
    researchRunId: string | null;
    rawFinalOutput: string | null;
    transportValidation: Agent3TransportDiagnostic;
    confidenceDiagnostic?: Agent3ConfidenceDiagnostic;
  }): Promise<string | null>;
  recordOutcome(diagnosticId: string | null, outcome: Partial<DiagnosticRecord["composition"]>): Promise<void>;
};

const defaultDirectory = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  ".tmp",
  "agent3-diagnostics",
);
const defaultMaxRuns = 20;

export function createDevelopmentAgent3RawDiagnosticCapture(options: {
  enabled?: boolean;
  directory?: string;
  maxRuns?: number;
  now?: () => Date;
  idFactory?: () => string;
} = {}): Agent3RawDiagnosticCapture {
  const enabled = options.enabled ?? process.env.NODE_ENV === "development";
  const directory = options.directory ?? defaultDirectory;
  const maxRuns = options.maxRuns ?? defaultMaxRuns;
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  return {
    async recordProviderCompletion(input, detail) {
      if (!enabled) return null;
      const diagnosticId = `${now().getTime()}-${idFactory()}`;
      const record: DiagnosticRecord = {
        diagnostic_id: diagnosticId,
        research_run_id: detail.researchRunId,
        catalog_product_id: input.catalog_product_id,
        model: detail.model,
        started_at: detail.startedAt.toISOString(),
        completed_at: detail.completedAt.toISOString(),
        input_identity: {
          brand_name: input.brand_name,
          product_name: input.product_name,
          variant_name: input.variant_name,
          barcode: input.barcode,
          aliases: input.aliases,
        },
        raw_final_output: detail.rawFinalOutput,
        transport_validation: detail.transportValidation,
        raw_confidence: detail.confidenceDiagnostic?.raw_confidence ?? null,
        cap: detail.confidenceDiagnostic?.cap ?? null,
        cap_reason: detail.confidenceDiagnostic?.cap_reason ?? null,
        final_confidence: detail.confidenceDiagnostic?.final_confidence ?? null,
        matched_source_count: detail.confidenceDiagnostic?.matched_source_count ?? 0,
        unmatched_source_count: detail.confidenceDiagnostic?.unmatched_source_count ?? 0,
        source_class_counts: detail.confidenceDiagnostic?.source_class_counts ?? {},
        source_classifications: detail.confidenceDiagnostic?.source_classifications ?? [],
        section_trust: detail.confidenceDiagnostic?.section_trust ?? {},
        composition: { schema_success: null, failure_kind: null, draft_created: null },
      };
      try {
        await mkdir(directory, { recursive: true });
        await writeRecord(directory, record);
        await prune(directory, maxRuns);
        return diagnosticId;
      } catch {
        return null;
      }
    },
    async recordOutcome(diagnosticId, outcome) {
      if (!enabled || !diagnosticId) return;
      try {
        const file = filePath(directory, diagnosticId);
        const record = JSON.parse(
          await readFile(/* turbopackIgnore: true */ file, "utf8"),
        ) as DiagnosticRecord;
        await writeRecord(directory, { ...record, composition: { ...record.composition, ...outcome } });
      } catch {
        // Diagnostics are intentionally non-blocking and must never alter research behavior.
      }
    },
  };
}

export async function recordDevelopmentAgent3DiagnosticOutcome(
  diagnosticId: string | null,
  outcome: Partial<DiagnosticRecord["composition"]>,
) {
  await createDevelopmentAgent3RawDiagnosticCapture().recordOutcome(diagnosticId, outcome);
}

function filePath(directory: string, diagnosticId: string) {
  return path.join(
    /* turbopackIgnore: true */ directory,
    `${diagnosticId}.json`,
  );
}
async function writeRecord(directory: string, record: DiagnosticRecord) {
  await writeFile(filePath(directory, record.diagnostic_id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
async function prune(directory: string, maxRuns: number) {
  const runtimeDirectory = path.resolve(
    /* turbopackIgnore: true */ directory,
  );
  const entries = await readdir(
    runtimeDirectory,
    { withFileTypes: true },
  );
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  await Promise.all(files.slice(0, Math.max(0, files.length - maxRuns)).map((entry) => rm(path.join(
    /* turbopackIgnore: true */ runtimeDirectory,
    entry.name,
  ), { force: true })));
}
