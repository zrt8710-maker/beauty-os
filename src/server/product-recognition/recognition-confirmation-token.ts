import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { ProductType } from "@/schemas/product";
import { getSupabaseAdminEnv } from "@/server/config/supabase-admin-env";

const TOKEN_TTL_MS = 15 * 60 * 1000;

type ExternalIdentity = {
  brand_name: string | null;
  product_name: string;
  variant_name: string | null;
  barcode: string | null;
  product_type: ProductType | null;
  image_url?: string | null;
  image_source_url?: string | null;
  discovery_metadata?: {
    aliases: string[];
    confidence: number;
    sources: Array<{ url: string; title: string | null; source_type: string | null }>;
    uncertainties: string[];
  };
};

type ConfirmationPayload = ExternalIdentity & {
  confirmation_id: string;
  user_id: string;
  expires_at: number;
  reconciliation_context?: IdentityReconciliationContext;
};

export type IdentityReconciliationContext = {
  original_brand_name: string | null;
  original_product_name: string | null;
};

type RecognitionObservation = {
  brand_name: string | null;
  product_name: string | null;
};

type RecognitionReferencePayload = RecognitionObservation & {
  kind: "recognition_reference";
  user_id: string;
  expires_at: number;
};

export class InvalidRecognitionConfirmationTokenError extends Error {
  constructor() {
    super("INVALID_RECOGNITION_CONFIRMATION_TOKEN");
    this.name = "InvalidRecognitionConfirmationTokenError";
  }
}

export class InvalidRecognitionReferenceError extends Error {
  constructor() {
    super("INVALID_RECOGNITION_REFERENCE");
    this.name = "InvalidRecognitionReferenceError";
  }
}

export function issueRecognitionReference(
  userId: string,
  identity: RecognitionObservation,
  now = Date.now(),
) {
  const payload: RecognitionReferencePayload = {
    ...identity,
    kind: "recognition_reference",
    user_id: userId,
    expires_at: now + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { recognition_reference: `${encodedPayload}.${sign(encodedPayload)}` };
}

export function verifyRecognitionReference(
  token: string,
  userId: string,
  identity: RecognitionObservation,
  now = Date.now(),
) {
  const [encodedPayload, signature, ...rest] = token.split(".");
  if (!encodedPayload || !signature || rest.length > 0 || !validSignature(encodedPayload, signature)) {
    throw new InvalidRecognitionReferenceError();
  }
  let payload: RecognitionReferencePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new InvalidRecognitionReferenceError();
  }
  if (
    payload.kind !== "recognition_reference"
    || payload.user_id !== userId
    || payload.expires_at <= now
    || normalize(payload.brand_name) !== normalize(identity.brand_name)
    || normalize(payload.product_name) !== normalize(identity.product_name)
  ) throw new InvalidRecognitionReferenceError();
}

export function issueRecognitionConfirmationToken(
  userId: string,
  identity: ExternalIdentity,
  now = Date.now(),
  reconciliationContext?: IdentityReconciliationContext,
) {
  const payload: ConfirmationPayload = {
    ...identity,
    confirmation_id: randomUUID(),
    user_id: userId,
    expires_at: now + TOKEN_TTL_MS,
    ...(reconciliationContext ? { reconciliation_context: reconciliationContext } : {}),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    confirmation_id: payload.confirmation_id,
    confirmation_token: `${encodedPayload}.${sign(encodedPayload)}`,
  };
}

export function verifyRecognitionConfirmationToken(
  token: string,
  userId: string,
  identity: ExternalIdentity,
  idempotencyKey: string,
  now = Date.now(),
): {
  image_url: string | null;
  image_source_url: string | null;
  discovery_metadata: ExternalIdentity["discovery_metadata"];
  reconciliation_context: IdentityReconciliationContext | null;
} {
  const [encodedPayload, signature, ...rest] = token.split(".");
  if (!encodedPayload || !signature || rest.length > 0 || !validSignature(encodedPayload, signature)) {
    throw new InvalidRecognitionConfirmationTokenError();
  }

  let payload: ConfirmationPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new InvalidRecognitionConfirmationTokenError();
  }

  if (
    payload.user_id !== userId
    || payload.confirmation_id !== idempotencyKey
    || payload.expires_at <= now
    || !sameIdentity(payload, identity)
  ) {
    throw new InvalidRecognitionConfirmationTokenError();
  }
  return {
    image_url: safeHttpsUrl(payload.image_url),
    image_source_url: safeHttpsUrl(payload.image_source_url),
    discovery_metadata: payload.discovery_metadata,
    reconciliation_context: validReconciliationContext(payload.reconciliation_context),
  };
}

function validReconciliationContext(value: IdentityReconciliationContext | undefined) {
  if (!value) return null;
  const brand = value.original_brand_name;
  const product = value.original_product_name;
  if ((brand !== null && typeof brand !== "string") || (product !== null && typeof product !== "string")) return null;
  return { original_brand_name: brand, original_product_name: product };
}

function sameIdentity(left: ExternalIdentity, right: ExternalIdentity) {
  return normalize(left.brand_name) === normalize(right.brand_name)
    && normalize(left.product_name) === normalize(right.product_name)
    && normalize(left.variant_name) === normalize(right.variant_name)
    && normalize(left.barcode) === normalize(right.barcode)
    && (left.product_type === null || left.product_type === right.product_type);
}

function normalize(value: string | null) {
  return value?.trim().toLocaleLowerCase("zh-CN") ?? null;
}
function safeHttpsUrl(value: string | null | undefined) { try { return value && new URL(value).protocol === "https:" ? value : null; } catch { return null; } }

function sign(value: string) {
  return createHmac("sha256", getSupabaseAdminEnv().SUPABASE_SERVICE_ROLE_KEY)
    .update(value)
    .digest("base64url");
}

function validSignature(value: string, signature: string) {
  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
