import "server-only";

import type { ZodIssue } from "zod";

type CreateStage =
  | "confirmation_token_invalid"
  | "rpc_failed"
  | "rpc_exception"
  | "rpc_empty_response"
  | "product_hydration_failed"
  | "create_failed";

type SafePostgresError = {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
};

type OwnedProductCreateDebugEvent = {
  create_stage: CreateStage;
  resolution_kind?: string;
  token_validation_status?: "not_required" | "valid" | "invalid";
  idempotency_key_present?: boolean;
  rpc_name?: string;
  postgres_error_code?: string | null;
  postgres_error_message?: string | null;
  postgres_error_details?: string | null;
  postgres_error_hint?: string | null;
  exception_name?: string | null;
  exception_message?: string | null;
  product_relation_status?: "present" | "missing";
  identified_image_url_present?: boolean;
  identified_image_source_url_present?: boolean;
  rpc_parameter_types?: {
    p_asset_category: "string";
    p_catalog_product_id: "null" | "string";
    p_idempotency_key: "string";
    p_manufacture_date: "null" | "string";
    p_package_size: "null" | "string";
    p_resolution_kind: "string";
    p_user_id: "string";
  };
};

export class OwnedProductIdentityRepositoryError extends Error {
  readonly postgres: SafePostgresError;

  readonly exception: SafeException | null;

  constructor(postgres: SafePostgresError, exception: SafeException | null = null) {
    super("OWNED_PRODUCT_IDENTITY_CREATE_FAILED");
    this.name = "OwnedProductIdentityRepositoryError";
    this.postgres = postgres;
    this.exception = exception;
  }
}

export function ownedProductCreateDebug(event: OwnedProductCreateDebugEvent) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("OWNED_PRODUCT_CREATE_DEBUG", event);
}

export type OwnedProductCreateTimingEvent = {
  stage: "catalog_backstop" | "external_catalog_binding" | "asset_rpc" | "fallback_hydration" | "research_trigger_registered";
  elapsed_ms: number;
};

export type OwnedProductCreateTimingReporter = (event: OwnedProductCreateTimingEvent) => void;

export function ownedProductCreateTimingDebug(
  path: "success" | "failed" | "unauthorized" | "invalid",
  timings: Array<OwnedProductCreateTimingEvent | { stage: "auth"; elapsed_ms: number }>,
  startedAt: number,
) {
  // Stage names and durations contain no product, user, or credential data.
  console.info("OWNED_PRODUCT_CREATE_TIMING", {
    path,
    timings,
    response_total_ms: Math.round(performance.now() - startedAt),
  });
}

/** Development-only validation diagnostics; never log request values or tokens. */
export function ownedProductCreateInvalidDebug(issues: ZodIssue[], input: unknown) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("OWNED_PRODUCT_CREATE_INVALID", {
    issues: issues.slice(0, 10).map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      expected: issueExpected(issue),
      received: valueCategory(valueAtPath(input, issue.path)),
    })),
  });
}

function issueExpected(issue: ZodIssue) {
  const value = (issue as unknown as { expected?: unknown }).expected;
  return typeof value === "string" ? value : null;
}

function valueAtPath(input: unknown, path: PropertyKey[]) {
  let value = input;
  for (const key of path) {
    if (typeof value !== "object" || value === null || !(key in value)) return undefined;
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value;
}

function valueCategory(value: unknown) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function toSafePostgresError(error: unknown): SafePostgresError {
  if (!isRecord(error)) {
    return { code: null, message: null, details: null, hint: null };
  }

  return {
    code: toSafeText(error.code),
    message: toSafeText(error.message),
    details: toSafeText(error.details),
    hint: toSafeText(error.hint),
  };
}

export function toSafeException(error: unknown): SafeException {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 500) };
  }
  return { name: typeof error, message: null };
}

type SafeException = {
  name: string;
  message: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toSafeText(value: unknown) {
  return typeof value === "string" ? value.slice(0, 500) : null;
}
