import "server-only";

import { readFile } from "node:fs/promises";
import { ZodError } from "zod";

import {
  productKnowledgeCurationInputSchema,
  type CapabilityAssessmentInput,
  type CapabilityEvidenceInput,
  type ProductKnowledgeCurationInput,
  type RoleAssignmentInput,
} from "@/schemas/product-knowledge-curation";
import type {
  ProductCapabilityEvidence,
  ProductKnowledgeCapability,
  ProductKnowledgeCareRole,
  ProductKnowledgeSnapshot,
} from "@/schemas/product-knowledge";
import {
  validateProductKnowledgeCuration,
  type ProductKnowledgeCurationWarning,
} from "@/server/domain/product-knowledge-curation";
import type { ProductKnowledgeCurationService } from "@/server/services/product-knowledge-curation-service";

export type ProductKnowledgeCurationImportMode = "dry-run" | "apply";
export type ProductKnowledgeCurationAssignmentChange =
  | "create"
  | "update"
  | "unchanged";
export type ProductKnowledgeCurationEvidenceChange =
  | "replace"
  | "unchanged";

export type ProductKnowledgeCurationRoleChange = {
  care_role_code: RoleAssignmentInput["care_role_code"];
  change: ProductKnowledgeCurationAssignmentChange;
  before: ComparableRoleAssignment | null;
  after: RoleAssignmentInput;
};

export type ProductKnowledgeCurationCapabilityChange = {
  capability_code: CapabilityAssessmentInput["capability_code"];
  change: ProductKnowledgeCurationAssignmentChange;
  before: ComparableCapabilityAssessment | null;
  after: Omit<CapabilityAssessmentInput, "capability_code" | "evidence">;
};

export type ProductKnowledgeCurationEvidenceSetChange = {
  capability_code: CapabilityAssessmentInput["capability_code"];
  change: ProductKnowledgeCurationEvidenceChange;
  before_count: number;
  after_count: number;
  before: ComparableEvidence[];
  after: CapabilityEvidenceInput[];
};

export type ProductKnowledgeCurationImportChanges = {
  roles: ProductKnowledgeCurationRoleChange[];
  capabilities: ProductKnowledgeCurationCapabilityChange[];
  evidence: ProductKnowledgeCurationEvidenceSetChange[];
};

export type ProductKnowledgeCurationImportError = {
  stage: "file" | "json" | "schema" | "validator" | "preview" | "apply";
  code: string;
  message: string;
  path?: Array<string | number>;
};

type ImportReportBase = {
  mode: ProductKnowledgeCurationImportMode;
  file_path: string;
  applied: boolean;
  product_identity: ProductKnowledgeSnapshot["identity"] | null;
  changes: ProductKnowledgeCurationImportChanges;
  warnings: ProductKnowledgeCurationWarning[];
};

export type ProductKnowledgeCurationImportSuccessReport = ImportReportBase & {
  success: true;
  errors: [];
};

export type ProductKnowledgeCurationImportFailureReport = ImportReportBase & {
  success: false;
  errors: ProductKnowledgeCurationImportError[];
};

export type ProductKnowledgeCurationImportReport =
  | ProductKnowledgeCurationImportSuccessReport
  | ProductKnowledgeCurationImportFailureReport;

export type ProductKnowledgeCurationImportRunner = {
  run(
    filePath: string,
    options?: { mode?: ProductKnowledgeCurationImportMode },
  ): Promise<ProductKnowledgeCurationImportReport>;
};

const emptyChanges = (): ProductKnowledgeCurationImportChanges => ({
  roles: [],
  capabilities: [],
  evidence: [],
});

export function createProductKnowledgeCurationImportRunner(
  service: ProductKnowledgeCurationService,
): ProductKnowledgeCurationImportRunner {
  return {
    async run(filePath, options = {}) {
      const mode = options.mode ?? "dry-run";
      let contents: string;

      try {
        contents = await readFile(filePath, "utf8");
      } catch (error) {
        return failureReport(mode, filePath, {
          errors: [toImportError("file", "CURATION_FILE_READ_FAILED", error)],
        });
      }

      let rawInput: unknown;
      try {
        rawInput = JSON.parse(contents);
      } catch (error) {
        return failureReport(mode, filePath, {
          errors: [toImportError("json", "CURATION_JSON_INVALID", error)],
        });
      }

      let input: ProductKnowledgeCurationInput;
      try {
        input = productKnowledgeCurationInputSchema.parse(rawInput);
      } catch (error) {
        if (error instanceof ZodError) {
          return failureReport(mode, filePath, {
            errors: error.issues.map((issue) => ({
              stage: "schema",
              code: "CURATION_SCHEMA_INVALID",
              message: issue.message,
              path: issue.path.map((segment) =>
                typeof segment === "number" ? segment : String(segment)),
            })),
          });
        }

        return failureReport(mode, filePath, {
          errors: [toImportError("schema", "CURATION_SCHEMA_INVALID", error)],
        });
      }

      const validation = validateProductKnowledgeCuration(input);
      if (!validation.valid) {
        return failureReport(mode, filePath, {
          warnings: validation.warnings,
          errors: validation.errors.map((error) => ({
            stage: "validator",
            code: error.code,
            message: error.message,
            path: error.path,
          })),
        });
      }

      let preview: Awaited<ReturnType<ProductKnowledgeCurationService["preview"]>>;
      try {
        preview = await service.preview(input);
      } catch (error) {
        return failureReport(mode, filePath, {
          warnings: validation.warnings,
          errors: [toImportError("preview", "CURATION_PREVIEW_FAILED", error)],
        });
      }

      const changes = buildChanges(input, preview.snapshot);
      const previewWarnings = mergeWarnings(
        validation.warnings,
        preview.warnings,
      );

      if (mode === "dry-run") {
        return {
          success: true,
          mode,
          file_path: filePath,
          applied: false,
          product_identity: preview.snapshot.identity,
          changes,
          warnings: previewWarnings,
          errors: [],
        };
      }

      try {
        const result = await service.curate(input);
        return {
          success: true,
          mode,
          file_path: filePath,
          applied: true,
          product_identity: result.snapshot.identity,
          changes,
          warnings: mergeWarnings(previewWarnings, result.warnings),
          errors: [],
        };
      } catch (error) {
        return failureReport(mode, filePath, {
          applied: hasCommittedWrite(error),
          productIdentity: preview.snapshot.identity,
          changes,
          warnings: previewWarnings,
          errors: [toImportError("apply", "CURATION_APPLY_FAILED", error)],
        });
      }
    },
  };
}

type ComparableRoleAssignment = Pick<
  RoleAssignmentInput,
  | "assignment_kind"
  | "status"
  | "confidence"
  | "assessment_note"
  | "source_locator"
  | "reviewed_at"
>;

type ComparableCapabilityAssessment = Pick<
  CapabilityAssessmentInput,
  "status" | "confidence" | "assessment_note" | "reviewed_at"
>;

type ComparableEvidence = Pick<
  CapabilityEvidenceInput,
  | "evidence_type"
  | "direction"
  | "evidence_note"
  | "source_locator"
  | "confidence"
  | "review_status"
>;

function buildChanges(
  input: ProductKnowledgeCurationInput,
  snapshot: ProductKnowledgeSnapshot,
): ProductKnowledgeCurationImportChanges {
  const roles = input.roles.map((assignment) => {
    const existing = snapshot.care_roles.find(
      (role) => role.care_role_code === assignment.care_role_code,
    );
    const before = existing ? comparableRole(existing) : null;

    return {
      care_role_code: assignment.care_role_code,
      change: !before
        ? "create" as const
        : sameValue(before, comparableRole(assignment))
          ? "unchanged" as const
          : "update" as const,
      before,
      after: assignment,
    };
  });

  const capabilities = input.capabilities.map((assessment) => {
    const existing = snapshot.capabilities.find(
      (capability) => capability.capability_code === assessment.capability_code,
    );
    const before = existing ? comparableCapability(existing) : null;
    const after = comparableCapability(assessment);

    return {
      capability_code: assessment.capability_code,
      change: !before
        ? "create" as const
        : sameValue(before, after)
          ? "unchanged" as const
          : "update" as const,
      before,
      after,
    };
  });

  const evidence = input.capabilities.map((assessment) => {
    const existing = snapshot.capabilities.find(
      (capability) => capability.capability_code === assessment.capability_code,
    );
    const before = (existing?.evidence ?? []).map(comparableEvidence);
    const after = assessment.evidence.map(comparableEvidence);

    return {
      capability_code: assessment.capability_code,
      change: sameEvidence(before, after)
        ? "unchanged" as const
        : "replace" as const,
      before_count: before.length,
      after_count: after.length,
      before,
      after,
    };
  });

  return { roles, capabilities, evidence };
}

function comparableRole(
  role: RoleAssignmentInput | ProductKnowledgeCareRole,
): ComparableRoleAssignment {
  return {
    assignment_kind: role.assignment_kind,
    status: role.status,
    confidence: role.confidence,
    assessment_note: role.assessment_note,
    source_locator: role.source_locator,
    reviewed_at: role.reviewed_at,
  };
}

function comparableCapability(
  capability: CapabilityAssessmentInput | ProductKnowledgeCapability,
): ComparableCapabilityAssessment {
  return {
    status: capability.status,
    confidence: capability.confidence,
    assessment_note: capability.assessment_note,
    reviewed_at: capability.reviewed_at,
  };
}

function comparableEvidence(
  evidence: CapabilityEvidenceInput | ProductCapabilityEvidence,
): ComparableEvidence {
  return {
    evidence_type: evidence.evidence_type,
    direction: evidence.direction,
    evidence_note: evidence.evidence_note,
    source_locator: evidence.source_locator,
    confidence: evidence.confidence,
    review_status: evidence.review_status,
  };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameEvidence(left: ComparableEvidence[], right: ComparableEvidence[]) {
  const leftFingerprints = left.map(evidenceFingerprint).sort();
  const rightFingerprints = right.map(evidenceFingerprint).sort();
  return sameValue(leftFingerprints, rightFingerprints);
}

function evidenceFingerprint(evidence: ComparableEvidence) {
  return JSON.stringify([
    evidence.evidence_type,
    evidence.direction,
    evidence.evidence_note,
    evidence.source_locator,
    evidence.confidence,
    evidence.review_status,
  ]);
}

function mergeWarnings(
  ...warningGroups: ProductKnowledgeCurationWarning[][]
) {
  const warnings = new Map<string, ProductKnowledgeCurationWarning>();
  warningGroups.flat().forEach((warning) => {
    warnings.set(
      JSON.stringify([warning.code, warning.message, warning.path]),
      warning,
    );
  });
  return [...warnings.values()];
}

function failureReport(
  mode: ProductKnowledgeCurationImportMode,
  filePath: string,
  details: {
    applied?: boolean;
    productIdentity?: ProductKnowledgeSnapshot["identity"] | null;
    changes?: ProductKnowledgeCurationImportChanges;
    warnings?: ProductKnowledgeCurationWarning[];
    errors: ProductKnowledgeCurationImportError[];
  },
): ProductKnowledgeCurationImportFailureReport {
  return {
    success: false,
    mode,
    file_path: filePath,
    applied: details.applied ?? false,
    product_identity: details.productIdentity ?? null,
    changes: details.changes ?? emptyChanges(),
    warnings: details.warnings ?? [],
    errors: details.errors,
  };
}

function toImportError(
  stage: ProductKnowledgeCurationImportError["stage"],
  fallbackCode: string,
  error: unknown,
): ProductKnowledgeCurationImportError {
  const code = hasStringProperty(error, "code")
    ? error.code
    : fallbackCode;
  const message = error instanceof Error ? error.message : fallbackCode;
  return { stage, code, message };
}

function hasCommittedWrite(error: unknown) {
  return hasBooleanProperty(error, "writeCommitted")
    && error.writeCommitted;
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
