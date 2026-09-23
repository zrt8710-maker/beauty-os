import { after, NextResponse } from "next/server";
import { ZodError } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseAdminConfigurationError } from "@/server/config/supabase-admin-env";
import { InvalidRecognitionConfirmationTokenError } from "@/server/product-recognition/recognition-confirmation-token";
import { createOwnedProductWithIdentitySchema } from "@/schemas/product-identity";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createOwnedProductIdentityRepository } from "@/server/repositories/owned-product-identity-repository";
import {
  CatalogIdentityConfirmationRequiredError,
  CatalogVariantConfirmationRequiredError,
  createConfirmedCatalogCandidateRepository,
} from "@/server/repositories/confirmed-catalog-candidate-repository";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createConfiguredVolcengineAgentPlanProductResearchProvider } from "@/server/product-research/volcengine-agent-plan-provider";
import { createConfiguredVolcengineSearchInfinityProvider } from "@/server/product-search/volcengine-search-infinity-provider";
import {
  OwnedProductIdentityRepositoryError,
  ownedProductCreateDebug,
  ownedProductCreateInvalidDebug,
  ownedProductCreateTimingDebug,
  type OwnedProductCreateTimingEvent,
} from "@/server/owned-products/owned-product-create-debug";
import {
  CatalogIdentityMismatchError,
  createOwnedProductWithIdentityService,
} from "@/server/services/create-owned-product-with-identity-service";
import { createProductIdentityMatcher } from "@/server/services/product-identity-matching-service";
import { createProductResearchTriggerService } from "@/server/services/product-research-trigger-service";

const headers = { "Cache-Control": "private, no-store" };

function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[] | undefined>,
) {
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status, headers },
  );
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const timings: Array<OwnedProductCreateTimingEvent | { stage: "auth"; elapsed_ms: number }> = [];
  const authStartedAt = performance.now();
  const user = await getCurrentUser();
  timings.push({ stage: "auth", elapsed_ms: Math.round(performance.now() - authStartedAt) });

  if (!user) {
    ownedProductCreateTimingDebug("unauthorized", timings, startedAt);
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  let input: unknown;
  let createContext: {
    resolution_kind: string;
    idempotency_key_present: boolean;
  } | null = null;
  try {
    input = await request.json();
  } catch {
    ownedProductCreateTimingDebug("invalid", timings, startedAt);
    return errorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }

  try {
    const validatedInput = createOwnedProductWithIdentitySchema.parse(input);
    createContext = {
      resolution_kind: validatedInput.resolution_kind,
      idempotency_key_present: Boolean(validatedInput.idempotency_key),
    };
    const supabase = createAdminClient();
    const researchTrigger = createProductResearchTriggerService({
      provider: createConfiguredVolcengineAgentPlanProductResearchProvider(),
      drafts: createProductResearchDraftRepository(supabase),
      knowledge: createKnowledgeRepository(supabase),
      model: process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim() ?? null,
      searchProvider: createConfiguredVolcengineSearchInfinityProvider(),
    });
    const service = createOwnedProductWithIdentityService(
      createProductIdentityMatcher(createCatalogIdentityRepository(supabase)),
      createOwnedProductIdentityRepository(supabase, (event) => timings.push(event)),
      createConfirmedCatalogCandidateRepository(supabase),
      (researchInput) => {
        after(async () => {
          await researchTrigger.trigger(researchInput);
        });
        timings.push({ stage: "research_trigger_registered", elapsed_ms: 0 });
      },
      (event) => timings.push(event),
    );
    const ownedProduct = await service.create(user.id, validatedInput);
    ownedProductCreateTimingDebug("success", timings, startedAt);
    return NextResponse.json(
      { data: ownedProduct },
      { status: 201, headers },
    );
  } catch (error) {
    if (error instanceof InvalidRecognitionConfirmationTokenError) {
      ownedProductCreateTimingDebug("failed", timings, startedAt);
      return errorResponse(409, "IDENTITY_CONFIRMATION_INVALID", "产品确认已失效，请重新查找并确认产品。");
    }

    if (error instanceof ZodError) {
      ownedProductCreateInvalidDebug(error.issues, input);
      ownedProductCreateTimingDebug("invalid", timings, startedAt);
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "产品或库存信息不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    if (error instanceof CatalogIdentityMismatchError) {
      ownedProductCreateTimingDebug("failed", timings, startedAt);
      return errorResponse(409, error.code, "所选目录产品已失效或与输入不匹配。");
    }

    if (error instanceof CatalogVariantConfirmationRequiredError) {
      ownedProductCreateTimingDebug("failed", timings, startedAt);
      return errorResponse(409, error.code, "产品版本证据不足，且目录中存在需要确认的同名产品。");
    }

    if (error instanceof CatalogIdentityConfirmationRequiredError) {
      ownedProductCreateTimingDebug("failed", timings, startedAt);
      return errorResponse(409, error.code, "知识库中存在可能相同的产品，请先确认已有目录产品。");
    }

    if (error instanceof OwnedProductIdentityRepositoryError) {
      ownedProductCreateDebug({
        create_stage: "create_failed",
        resolution_kind: createContext?.resolution_kind,
        idempotency_key_present: createContext?.idempotency_key_present,
        postgres_error_code: error.postgres.code,
        postgres_error_message: error.postgres.message,
        postgres_error_details: error.postgres.details,
        postgres_error_hint: error.postgres.hint,
        exception_name: error.exception?.name ?? null,
        exception_message: error.exception?.message ?? null,
      });
    } else {
      const exceptionName = error instanceof Error ? error.name : typeof error;
      const exceptionMessage = error instanceof Error ? error.message.slice(0, 500) : null;
      ownedProductCreateDebug({
        create_stage: "create_failed",
        resolution_kind: createContext?.resolution_kind,
        idempotency_key_present: createContext?.idempotency_key_present,
        exception_name: exceptionName,
        exception_message: exceptionMessage,
      });
    }

    ownedProductCreateTimingDebug("failed", timings, startedAt);
    if (error instanceof SupabaseAdminConfigurationError) {
      return errorResponse(500, error.code, "资产服务配置异常，请稍后重试。");
    }
    if (error instanceof OwnedProductIdentityRepositoryError) {
      const postgresCode = error.postgres.code;
      return errorResponse(
        500,
        postgresCode && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(postgresCode)
          ? `OWNED_PRODUCT_RPC_${postgresCode}`
          : "OWNED_PRODUCT_RPC_FAILED",
        "资产保存失败，请刷新页面确认后重试。",
      );
    }
    if (error instanceof Error && error.message === "CONFIRMED_CATALOG_CANDIDATE_READ_FAILED") {
      return errorResponse(500, "CATALOG_CANDIDATE_READ_FAILED", "产品目录读取失败，请稍后重试。");
    }
    if (error instanceof Error && error.message === "CONFIRMED_CATALOG_CANDIDATE_WRITE_FAILED") {
      return errorResponse(500, "CATALOG_CANDIDATE_WRITE_FAILED", "产品目录保存失败，请稍后重试。");
    }
    return errorResponse(500, "OWNED_PRODUCT_CREATE_FAILED", "资产保存失败，请刷新页面确认后重试。");
  }
}
