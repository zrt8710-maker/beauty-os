import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { externalIdentityConfirmationRequestSchema } from "@/schemas/product-identity-resolution";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { verifyRecognitionConfirmationToken, InvalidRecognitionConfirmationTokenError } from "@/server/product-recognition/recognition-confirmation-token";
import {
  CatalogIdentityConfirmationRequiredError,
  CatalogVariantConfirmationRequiredError,
  createConfirmedCatalogCandidateRepository,
} from "@/server/repositories/confirmed-catalog-candidate-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { durableExternalVariantEvidence } from "@/server/services/create-owned-product-with-identity-service";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse(401, "UNAUTHORIZED", "请先登录。");

  try {
    const input = externalIdentityConfirmationRequestSchema.parse(await request.json());
    const confirmed = verifyRecognitionConfirmationToken(
      input.confirmation_token,
      user.id,
      input,
      input.confirmation_id,
    );
    const supabase = createAdminClient();
    const catalogProductId = await createConfirmedCatalogCandidateRepository(supabase).findOrCreate({
      brand_name: input.brand_name,
      product_name: input.product_name,
      variant_name: input.variant_name,
      barcode: input.barcode,
      confidence: confirmed.discovery_metadata?.confidence ?? 0,
      aliases: confirmed.discovery_metadata?.aliases ?? [],
      product_type: input.product_type,
      variant_evidence: durableExternalVariantEvidence(input.variant_name, input.barcode, confirmed.discovery_metadata),
      original_identity: confirmed.reconciliation_context
        ? {
            brand_name: confirmed.reconciliation_context.original_brand_name,
            product_name: confirmed.reconciliation_context.original_product_name,
          }
        : null,
    });
    const analysisReady = Boolean(await createKnowledgeRepository(supabase).findVerifiedProduct(catalogProductId));
    return NextResponse.json({ data: { catalog_product_id: catalogProductId, analysis_ready: analysisReady } }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(400, "VALIDATION_ERROR", "候选产品信息不符合要求。");
    if (error instanceof InvalidRecognitionConfirmationTokenError) return errorResponse(403, "INVALID_CONFIRMATION", "产品确认已失效，请重新查找。");
    if (error instanceof CatalogIdentityConfirmationRequiredError || error instanceof CatalogVariantConfirmationRequiredError) {
      return errorResponse(409, error.code, "目录中仍有相近产品，请重新查找并确认正确产品。");
    }
    return errorResponse(500, "IDENTITY_CONFIRMATION_FAILED", "暂时无法确认产品，请稍后重试。");
  }
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
