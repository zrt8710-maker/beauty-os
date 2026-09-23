import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  productIdentityResolutionRequestSchema,
  productIdentityResolutionSchema,
  type ExternalProductIdentity,
} from "@/schemas/product-identity-resolution";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createRequestProductIdentityAgent } from "@/server/product-identity/product-identity-composition";
import {
  issueRecognitionConfirmationToken,
  InvalidRecognitionReferenceError,
  verifyRecognitionReference,
} from "@/server/product-recognition/recognition-confirmation-token";
import {
  productIdentityDebug,
  type ProductIdentityTimingEvent,
} from "@/server/product-identity/identity-research-debug";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const startedAt = performance.now();
  const timings: ProductIdentityTimingEvent[] = [];
  const timingReporter = (event: ProductIdentityTimingEvent) => timings.push(event);
  const authStartedAt = performance.now();
  const user = await getCurrentUser();
  timingReporter({ stage: "auth", elapsed_ms: Math.round(performance.now() - authStartedAt) });
  if (!user) {
    logTiming("unauthorized", timings, startedAt);
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  try {
    const input = productIdentityResolutionRequestSchema.parse(await request.json());
    if (input.identity_clue.source === "image_recognition") {
      verifyRecognitionReference(
        input.recognition_reference!,
        user.id,
        input.identity_clue,
      );
    }
    const setupStartedAt = performance.now();
    const agent = await createRequestProductIdentityAgent(timingReporter);
    timingReporter({ stage: "agent_service_setup", elapsed_ms: Math.round(performance.now() - setupStartedAt) });
    const resolution = await agent.resolve(input.identity_clue, {
        declinedCatalogProductIds: input.declined_catalog_product_ids,
        timingReporter,
      });
    const reconciliationContext = {
      original_brand_name: input.identity_clue.brand_name,
      original_product_name: input.identity_clue.product_name,
    };
    const signExternalCandidate = (candidate: ExternalProductIdentity) => ({
      ...candidate,
      ...issueRecognitionConfirmationToken(user.id, candidate, Date.now(), reconciliationContext),
    });
    const response = resolution.status === "external_candidate"
      ? { ...resolution, candidates: resolution.candidates.map(signExternalCandidate) }
      : resolution.status === "catalog_candidates" && (resolution.fallback_external_candidates?.length ?? 0) > 0
        ? {
            ...resolution,
            fallback_external_candidates: resolution.fallback_external_candidates.map(signExternalCandidate),
          }
        : resolution;
    logTiming(resolution.status === "matched" || resolution.status === "catalog_candidates" ? "internal_hit" : "external_discovery", timings, startedAt);
    return NextResponse.json({ data: productIdentityResolutionSchema.parse(response) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) {
      logTiming("invalid", timings, startedAt);
      return errorResponse(400, "IDENTITY_RESOLUTION_INVALID", "产品身份信息不符合要求。");
    }
    if (error instanceof InvalidRecognitionReferenceError) {
      logTiming("invalid_recognition_reference", timings, startedAt);
      return errorResponse(403, "INVALID_RECOGNITION_REFERENCE", "识别结果已失效，请重新识别产品。");
    }
    logTiming("failed", timings, startedAt);
    return errorResponse(500, "IDENTITY_RESOLUTION_FAILED", "暂时无法查找产品信息。");
  }
}

function logTiming(path: "internal_hit" | "external_discovery" | "unauthorized" | "invalid" | "invalid_recognition_reference" | "failed", timings: ProductIdentityTimingEvent[], startedAt: number) {
  // Production timing contains only stage names and durations, never search text.
  if (process.env.NODE_ENV === "production") {
    console.info("PRODUCT_IDENTITY_RESOLVE_TIMING", {
      path,
      timings: timings.map(({ stage, elapsed_ms }) => ({ stage, elapsed_ms })),
      total_ms: Math.round(performance.now() - startedAt),
    });
    return;
  }
  productIdentityDebug("Resolve Timing", {
    path,
    timings: timings.map((event) => ({ ...event })),
    total_ms: Math.round(performance.now() - startedAt),
  });
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
