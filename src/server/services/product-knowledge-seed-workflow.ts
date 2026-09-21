import "server-only";

import { readFile } from "node:fs/promises";
import { ZodError } from "zod";

import type {
  CatalogSeedDryRunReport,
  CatalogSeedInput,
} from "@/schemas/catalog-seed";
import { productKnowledgeCurationInputSchema } from "@/schemas/product-knowledge-curation";
import type { ProductKnowledgeCurationInput } from "@/schemas/product-knowledge-curation";
import type { CatalogSeedDryRunChecker } from "@/server/catalog-seed/catalog-seed-dry-run";
import { validateCatalogSeed } from "@/server/domain/catalog-seed";
import { validateProductKnowledgeCuration } from "@/server/domain/product-knowledge-curation";
import type { CatalogSeedService } from "@/server/services/catalog-seed-service";
import type {
  ProductKnowledgeCurationImportReport,
  ProductKnowledgeCurationImportRunner,
} from "@/server/services/product-knowledge-curation-import-runner";

export const PRODUCT_KNOWLEDGE_SEED_REPORT_VERSION =
  "product-knowledge-seed-report/v0.1" as const;

export type ProductKnowledgeSeedMode = "validate" | "dry-run" | "apply";

export type ProductKnowledgeSeedFiles = {
  productKey: string;
  identityFilePath: string;
  knowledgeFilePath: string;
};

export type ProductKnowledgeSeedError = {
  stage: "file" | "json" | "identity" | "knowledge" | "pair" | "apply";
  code: string;
  message: string;
  path?: Array<string | number>;
};

export type ProductKnowledgeSeedWarning = {
  stage: "identity" | "knowledge";
  code: string;
  message: string;
  path: Array<string | number>;
  catalog_product_id?: string | null;
  conflicting_catalog_product_id?: string | null;
};

export type ProductKnowledgeSeedWorkflowReport = {
  report_version: typeof PRODUCT_KNOWLEDGE_SEED_REPORT_VERSION;
  mode: ProductKnowledgeSeedMode;
  product_key: string;
  catalog_product_id: string | null;
  success: boolean;
  identity: {
    status:
      | "invalid"
      | "validated"
      | "new"
      | "existing"
      | "conflict"
      | "applied";
    applied: boolean;
    dry_run: CatalogSeedDryRunReport | null;
  };
  knowledge: {
    status:
      | "invalid"
      | "validated"
      | "preview_deferred"
      | "ready"
      | "applied";
    applied: boolean;
    import_report: ProductKnowledgeCurationImportReport | null;
  };
  warnings: ProductKnowledgeSeedWarning[];
  errors: ProductKnowledgeSeedError[];
};

export type ProductKnowledgeSeedWorkflowDependencies = {
  catalogDryRun: CatalogSeedDryRunChecker;
  catalogService: CatalogSeedService;
  curationRunner: ProductKnowledgeCurationImportRunner;
};

export type ProductKnowledgeSeedWorkflow = {
  run(
    files: ProductKnowledgeSeedFiles,
    options?: { mode?: ProductKnowledgeSeedMode },
  ): Promise<ProductKnowledgeSeedWorkflowReport>;
};

type LoadedSeedPair = {
  identity: CatalogSeedInput;
  knowledge: ProductKnowledgeCurationInput;
  warnings: ProductKnowledgeSeedWarning[];
};

export function createProductKnowledgeSeedWorkflow(
  dependencies?: ProductKnowledgeSeedWorkflowDependencies,
): ProductKnowledgeSeedWorkflow {
  return {
    async run(files, options = {}) {
      const mode = options.mode ?? "dry-run";
      const loaded = await loadAndValidatePair(files, mode);
      if ("report" in loaded) return loaded.report;

      const { identity, warnings } = loaded.pair;
      const base = baseReport(
        files,
        mode,
        identity.catalog_product_id,
        warnings,
      );

      if (mode === "validate") {
        return { ...base, success: true };
      }

      if (!dependencies) {
        return failure(base, {
          stage: "apply",
          code: "KNOWLEDGE_SEED_DATABASE_DEPENDENCIES_MISSING",
          message: "dry-run/apply 需要受信任的 Catalog 与 Curation Service。",
        });
      }

      let preflight: CatalogSeedDryRunReport;
      try {
        preflight = await dependencies.catalogDryRun.run(identity);
      } catch (error) {
        return failure(base, toError("identity", "CATALOG_SEED_DRY_RUN_FAILED", error));
      }

      const preflightBase: ProductKnowledgeSeedWorkflowReport = {
        ...base,
        identity: {
          ...base.identity,
          status: preflight.status === "invalid"
            ? "invalid"
            : preflight.status,
          dry_run: preflight,
        },
        warnings: mergeWarnings(
          base.warnings,
          preflight.warnings.map((warning) => ({
            stage: "identity" as const,
            ...warning,
          })),
        ),
      };

      if (preflight.status === "invalid" || preflight.status === "conflict") {
        return {
          ...preflightBase,
          success: false,
          errors: [...preflight.errors, ...preflight.conflicts].map((issue) => ({
            stage: "identity" as const,
            code: issue.code,
            message: issue.message,
            path: issue.path,
          })),
        };
      }

      if (mode === "dry-run") {
        if (preflight.status === "new") {
          return {
            ...preflightBase,
            success: true,
            knowledge: {
              ...preflightBase.knowledge,
              status: "preview_deferred",
            },
          };
        }

        const knowledgeReport = await dependencies.curationRunner.run(
          files.knowledgeFilePath,
          { mode: "dry-run" },
        );
        return withKnowledgeReport(preflightBase, knowledgeReport, "ready");
      }

      let identityApplied = false;
      try {
        const result = await dependencies.catalogService.apply(identity);
        identityApplied = result.receipt.outcome === "created";
      } catch (error) {
        const writeCommitted = hasBooleanProperty(error, "writeCommitted")
          && error.writeCommitted;
        const failureBase = writeCommitted
          ? {
            ...preflightBase,
            identity: {
              ...preflightBase.identity,
              status: "applied" as const,
              applied: true,
            },
          }
          : preflightBase;
        return failure(failureBase, toError(
          "apply",
          "CATALOG_SEED_APPLY_FAILED",
          error,
        ));
      }

      const appliedIdentityBase: ProductKnowledgeSeedWorkflowReport = {
        ...preflightBase,
        identity: {
          ...preflightBase.identity,
          status: "applied",
          applied: identityApplied,
        },
      };
      const knowledgeReport = await dependencies.curationRunner.run(
        files.knowledgeFilePath,
        { mode: "apply" },
      );

      return withKnowledgeReport(
        appliedIdentityBase,
        knowledgeReport,
        "applied",
      );
    },
  };
}

async function loadAndValidatePair(
  files: ProductKnowledgeSeedFiles,
  mode: ProductKnowledgeSeedMode,
): Promise<
  | { pair: LoadedSeedPair }
  | { report: ProductKnowledgeSeedWorkflowReport }
> {
  const base = baseReport(files, mode, null, []);
  const identityJson = await readJson(files.identityFilePath, "identity");
  const knowledgeJson = await readJson(files.knowledgeFilePath, "knowledge");
  const fileErrors = [identityJson, knowledgeJson]
    .filter((result): result is { error: ProductKnowledgeSeedError } =>
      "error" in result)
    .map((result) => result.error);

  if (fileErrors.length > 0) {
    return { report: { ...base, success: false, errors: fileErrors } };
  }

  if ("error" in identityJson || "error" in knowledgeJson) {
    throw new Error("KNOWLEDGE_SEED_FILE_NARROWING_FAILED");
  }

  const identityValidation = validateCatalogSeed(identityJson.value);
  const knowledgeParse = productKnowledgeCurationInputSchema.safeParse(
    knowledgeJson.value,
  );
  const errors: ProductKnowledgeSeedError[] = identityValidation.errors.map(
    (error) => ({
      stage: "identity",
      code: error.code,
      message: error.message,
      path: error.path,
    }),
  );

  if (!knowledgeParse.success) {
    errors.push(...knowledgeParse.error.issues.map((issue) => ({
      stage: "knowledge" as const,
      code: "PRODUCT_KNOWLEDGE_CURATION_SCHEMA_INVALID",
      message: issue.message,
      path: issue.path.map((segment) =>
        typeof segment === "number" ? segment : String(segment)),
    })));
  }

  if (!identityValidation.input || !knowledgeParse.success) {
    return {
      report: {
        ...base,
        success: false,
        errors,
        identity: { ...base.identity, status: "invalid" },
        knowledge: { ...base.knowledge, status: "invalid" },
      },
    };
  }

  const identity = identityValidation.input;
  const knowledge = knowledgeParse.data;
  const knowledgeValidation = validateProductKnowledgeCuration(knowledge);
  errors.push(...knowledgeValidation.errors.map((error) => ({
    stage: "knowledge" as const,
    code: error.code,
    message: error.message,
    path: error.path,
  })));

  if (identity.catalog_product_id !== knowledge.catalog_product_id) {
    errors.push({
      stage: "pair",
      code: "KNOWLEDGE_SEED_CATALOG_PRODUCT_ID_MISMATCH",
      message: "identity 与 knowledge 文件必须使用相同的 catalog_product_id。",
      path: ["catalog_product_id"],
    });
  }

  const verifiedPrimaryRoles = knowledge.roles.filter(
    (role) =>
      role.assignment_kind === "primary" && role.status === "verified",
  );
  if (verifiedPrimaryRoles.length !== 1) {
    errors.push({
      stage: "knowledge",
      code: "KNOWLEDGE_SEED_VERIFIED_PRIMARY_ROLE_REQUIRED",
      message: "每个 Seed 必须且只能包含一个 verified primary care role。",
      path: ["roles"],
    });
  }

  if (errors.length > 0) {
    return {
      report: {
        ...base,
        catalog_product_id: identity.catalog_product_id,
        success: false,
        errors,
        warnings: mergeWarnings(
          toIdentityWarnings(identityValidation.warnings),
          knowledgeValidation.warnings.map((warning) => ({
            stage: "knowledge" as const,
            code: warning.code,
            message: warning.message,
            path: warning.path,
          })),
        ),
        identity: { ...base.identity, status: "invalid" },
        knowledge: { ...base.knowledge, status: "invalid" },
      },
    };
  }

  return {
    pair: {
      identity,
      knowledge,
      warnings: mergeWarnings(
        toIdentityWarnings(identityValidation.warnings),
        knowledgeValidation.warnings.map((warning) => ({
          stage: "knowledge" as const,
          code: warning.code,
          message: warning.message,
          path: warning.path,
        })),
      ),
    },
  };
}

async function readJson(
  filePath: string,
  stage: "identity" | "knowledge",
): Promise<{ value: unknown } | { error: ProductKnowledgeSeedError }> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    return { error: toError("file", `${stage.toUpperCase()}_FILE_READ_FAILED`, error) };
  }

  try {
    return { value: JSON.parse(contents) };
  } catch (error) {
    return { error: toError("json", `${stage.toUpperCase()}_JSON_INVALID`, error) };
  }
}

function baseReport(
  files: ProductKnowledgeSeedFiles,
  mode: ProductKnowledgeSeedMode,
  catalogProductId: string | null,
  warnings: ProductKnowledgeSeedWarning[],
): ProductKnowledgeSeedWorkflowReport {
  return {
    report_version: PRODUCT_KNOWLEDGE_SEED_REPORT_VERSION,
    mode,
    product_key: files.productKey,
    catalog_product_id: catalogProductId,
    success: false,
    identity: { status: "validated", applied: false, dry_run: null },
    knowledge: { status: "validated", applied: false, import_report: null },
    warnings,
    errors: [],
  };
}

function withKnowledgeReport(
  base: ProductKnowledgeSeedWorkflowReport,
  report: ProductKnowledgeCurationImportReport,
  successStatus: "ready" | "applied",
): ProductKnowledgeSeedWorkflowReport {
  return {
    ...base,
    success: report.success,
    knowledge: {
      status: report.success ? successStatus : "invalid",
      applied: report.applied,
      import_report: report,
    },
    errors: report.success
      ? []
      : report.errors.map((error) => ({
        stage: error.stage === "apply" ? "apply" : "knowledge",
        code: error.code,
        message: error.message,
        path: error.path,
      })),
  };
}

function failure(
  base: ProductKnowledgeSeedWorkflowReport,
  error: ProductKnowledgeSeedError,
): ProductKnowledgeSeedWorkflowReport {
  return { ...base, success: false, errors: [error] };
}

function toIdentityWarnings(
  warnings: Array<{ code: string; message: string; path: Array<string | number> }>,
): ProductKnowledgeSeedWarning[] {
  return warnings.map((warning) => ({
    stage: "identity",
    ...warning,
    catalog_product_id: null,
    conflicting_catalog_product_id: null,
  }));
}

function mergeWarnings(
  ...warningGroups: ProductKnowledgeSeedWarning[][]
) {
  const warnings = new Map<string, ProductKnowledgeSeedWarning>();
  warningGroups.flat().forEach((warning) => {
    warnings.set(
      JSON.stringify([warning.stage, warning.code, warning.path]),
      warning,
    );
  });
  return [...warnings.values()];
}

function toError(
  stage: ProductKnowledgeSeedError["stage"],
  fallbackCode: string,
  error: unknown,
): ProductKnowledgeSeedError {
  if (error instanceof ZodError) {
    return {
      stage,
      code: fallbackCode,
      message: error.issues.map((issue) => issue.message).join("; "),
    };
  }

  const code = hasStringProperty(error, "code") ? error.code : fallbackCode;
  const message = error instanceof Error ? error.message : fallbackCode;
  return { stage, code, message };
}

function hasStringProperty(
  value: unknown,
  property: string,
): value is Record<string, string> {
  return typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>)[property] === "string";
}

function hasBooleanProperty(
  value: unknown,
  property: string,
): value is Record<string, boolean> {
  return typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>)[property] === "boolean";
}
