import "server-only";

import {
  catalogSeedReadbackSchema,
  type CatalogSeedDryRunIssue,
  type CatalogSeedInput,
  type CatalogSeedReadback,
  type CatalogSeedWriteReceipt,
} from "@/schemas/catalog-seed";
import type { CatalogSeedDryRunChecker } from "@/server/catalog-seed/catalog-seed-dry-run";
import {
  validateCatalogSeed,
  type CatalogSeedValidationError,
  type CatalogSeedValidationWarning,
} from "@/server/domain/catalog-seed";
import type {
  CatalogProductWithSourceRow,
  KnowledgeRepository,
} from "@/server/repositories/knowledge-repository";
import type { CatalogSeedWriteRepository } from "@/server/repositories/catalog-seed-write-repository";

export class CatalogSeedServiceValidationError extends Error {
  readonly code = "CATALOG_SEED_VALIDATION_FAILED";
  readonly writeCommitted = false;

  constructor(
    public readonly errors: CatalogSeedValidationError[],
    public readonly warnings: CatalogSeedValidationWarning[],
  ) {
    super("CATALOG_SEED_VALIDATION_FAILED");
    this.name = "CatalogSeedServiceValidationError";
  }
}

export class CatalogSeedServiceConflictError extends Error {
  readonly code = "CATALOG_SEED_PREFLIGHT_CONFLICT";
  readonly writeCommitted = false;

  constructor(
    public readonly conflicts: CatalogSeedDryRunIssue[],
    public readonly warnings: CatalogSeedDryRunIssue[],
  ) {
    super("CATALOG_SEED_PREFLIGHT_CONFLICT");
    this.name = "CatalogSeedServiceConflictError";
  }
}

export type CatalogSeedReadbackErrorCode =
  | "CATALOG_SEED_READBACK_FAILED"
  | "CATALOG_SEED_READBACK_NOT_FOUND"
  | "CATALOG_SEED_READBACK_INVALID"
  | "CATALOG_SEED_READBACK_MISMATCH";

export class CatalogSeedReadbackError extends Error {
  constructor(
    public readonly code: CatalogSeedReadbackErrorCode,
    public readonly catalogProductId: string,
    public readonly writeCommitted: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "CatalogSeedReadbackError";
  }
}

export type CatalogSeedServiceResult = {
  receipt: CatalogSeedWriteReceipt;
  readback: CatalogSeedReadback;
  warnings: CatalogSeedDryRunIssue[];
};

export type CatalogSeedService = {
  apply(input: unknown): Promise<CatalogSeedServiceResult>;
};

export type CatalogSeedReadbackRepository = Pick<
  KnowledgeRepository,
  "findVerifiedProduct"
>;

export function createCatalogSeedService(
  dryRun: CatalogSeedDryRunChecker,
  writeRepository: CatalogSeedWriteRepository,
  readRepository: CatalogSeedReadbackRepository,
): CatalogSeedService {
  return {
    async apply(rawInput) {
      const validation = validateCatalogSeed(rawInput);

      if (!validation.valid || validation.input === null) {
        throw new CatalogSeedServiceValidationError(
          validation.errors,
          validation.warnings,
        );
      }

      const input = validation.input;
      const preflight = await dryRun.run(input);

      if (preflight.status === "invalid") {
        throw new Error("CATALOG_SEED_PREFLIGHT_INVALID_AFTER_VALIDATION");
      }

      if (preflight.status === "conflict") {
        throw new CatalogSeedServiceConflictError(
          preflight.conflicts,
          preflight.warnings,
        );
      }

      const receipt = preflight.status === "existing"
        ? existingReceipt(input)
        : await writeRepository.applyAtomically(input);
      const writeCommitted = receipt.outcome === "created";
      const readback = await readAndVerify(
        input,
        receipt,
        readRepository,
        writeCommitted,
      );

      return {
        receipt,
        readback,
        warnings: preflight.warnings,
      };
    },
  };
}

function existingReceipt(input: CatalogSeedInput): CatalogSeedWriteReceipt {
  return {
    outcome: "existing",
    catalog_product_id: input.catalog_product_id,
    source_id: input.source.source_id,
    source_created: false,
    catalog_product_created: false,
    status: "verified",
  };
}

async function readAndVerify(
  input: CatalogSeedInput,
  receipt: CatalogSeedWriteReceipt,
  repository: CatalogSeedReadbackRepository,
  writeCommitted: boolean,
): Promise<CatalogSeedReadback> {
  let row: CatalogProductWithSourceRow | null;

  try {
    row = await repository.findVerifiedProduct(input.catalog_product_id);
  } catch (cause) {
    throw new CatalogSeedReadbackError(
      "CATALOG_SEED_READBACK_FAILED",
      input.catalog_product_id,
      writeCommitted,
      { cause },
    );
  }

  if (row === null) {
    throw new CatalogSeedReadbackError(
      "CATALOG_SEED_READBACK_NOT_FOUND",
      input.catalog_product_id,
      writeCommitted,
    );
  }

  let readback: CatalogSeedReadback;
  try {
    readback = catalogSeedReadbackSchema.parse(toReadback(row));
  } catch (cause) {
    throw new CatalogSeedReadbackError(
      "CATALOG_SEED_READBACK_INVALID",
      input.catalog_product_id,
      writeCommitted,
      { cause },
    );
  }

  if (
    receipt.catalog_product_id !== input.catalog_product_id
    || receipt.source_id !== input.source.source_id
    || receipt.status !== "verified"
    || !readbackMatches(input, readback)
  ) {
    throw new CatalogSeedReadbackError(
      "CATALOG_SEED_READBACK_MISMATCH",
      input.catalog_product_id,
      writeCommitted,
    );
  }

  return readback;
}

function toReadback(row: CatalogProductWithSourceRow): CatalogSeedReadback {
  return {
    catalog_product_id: row.id,
    brand_name: row.brand_name,
    product_name: row.product_name,
    variant_name: row.variant_name,
    barcode: row.barcode,
    category: row.category as CatalogSeedReadback["category"],
    subcategory: row.subcategory as CatalogSeedReadback["subcategory"],
    product_type: row.product_type as CatalogSeedReadback["product_type"],
    source: {
      source_id: row.source.id,
      source_type: row.source.source_type as CatalogSeedReadback["source"]["source_type"],
      name: row.source.name,
      source_url: row.source.source_url,
      license_note: row.source.license_note,
      retrieved_at: row.source.retrieved_at,
    },
    confidence: row.confidence,
    status: row.status as CatalogSeedReadback["status"],
  };
}

function readbackMatches(
  input: CatalogSeedInput,
  readback: CatalogSeedReadback,
): boolean {
  return readback.catalog_product_id === input.catalog_product_id
    && readback.brand_name === input.identity.brand_name
    && readback.product_name === input.identity.product_name
    && readback.variant_name === input.identity.variant_name
    && readback.barcode === input.identity.barcode
    && readback.category === input.identity.category
    && readback.subcategory === input.identity.subcategory
    && readback.product_type === input.identity.product_type
    && readback.confidence === input.identity.confidence
    && readback.status === input.identity.status
    && readback.source.source_id === input.source.source_id
    && readback.source.source_type === input.source.source_type
    && readback.source.name === input.source.name
    && readback.source.source_url === input.source.source_url
    && readback.source.license_note === input.source.license_note
    && sameInstant(readback.source.retrieved_at, input.source.retrieved_at);
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}
