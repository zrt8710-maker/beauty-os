import "server-only";

import type { ProductKnowledgeSnapshot } from "@/schemas/product-knowledge";
import {
  resolveProductDecisionProfile,
  type ProductDecisionProfile,
} from "@/server/domain/product-decision";
import { buildRoutinePlan } from "@/server/services/rule-engine-service";

export const DATA_BOUNDARY_VALIDATION_VERSION =
  "beauty-os-data-boundary/v0.1" as const;

export type DataBoundaryValidationCase = {
  code:
    | "NO_CATALOG_FALLBACK"
    | "CATALOG_WITHOUT_VERIFIED_KNOWLEDGE"
    | "VERIFIED_KNOWLEDGE_ENHANCEMENT"
    | "UNKNOWN_IDENTITY_REMAINS_USABLE";
  passed: boolean;
  identity_status: "matched" | "unknown";
  catalog_product_id: string | null;
  knowledge_status: ProductDecisionProfile["knowledge_status"];
  role: string | null;
  role_source: ProductDecisionProfile["primary_role_source"];
  routine_selected: boolean;
  false_knowledge_generated: boolean;
  expectation: string;
};

export type DataBoundaryValidationReport = {
  schema_version: typeof DATA_BOUNDARY_VALIDATION_VERSION;
  all_passed: boolean;
  boundaries: {
    user_asset: string;
    external_fact: string;
    beauty_os_knowledge: string;
  };
  cases: DataBoundaryValidationCase[];
};

export function runDataBoundaryValidation(): DataBoundaryValidationReport {
  const cases = [
    validateCase({
      code: "NO_CATALOG_FALLBACK",
      identityStatus: "matched",
      productType: "moisturizer",
      catalogProductId: null,
      knowledge: null,
      expectedRole: "moisturizer",
      expectedSource: "product_type_fallback",
      expectedRoutineSelected: false,
      expectation: "无 Catalog 的用户产品仍可用 product_type fallback 识别角色；AM 无明确 need 时不自动进入 Routine。",
    }),
    validateCase({
      code: "CATALOG_WITHOUT_VERIFIED_KNOWLEDGE",
      identityStatus: "matched",
      productType: "serum",
      catalogProductId: CATALOG_ID,
      knowledge: knowledgeSnapshot(),
      expectedRole: "treatment",
      expectedSource: "product_type_fallback",
      expectedRoutineSelected: false,
      expectation: "有 Catalog 但无 verified knowledge 时仍使用 fallback 识别角色；没有明确 treatment direction 时不进入 Routine。",
    }),
    validateCase({
      code: "VERIFIED_KNOWLEDGE_ENHANCEMENT",
      identityStatus: "matched",
      productType: "serum",
      catalogProductId: CATALOG_ID,
      knowledge: knowledgeSnapshot({ verifiedRole: "moisturizer" }),
      expectedRole: "moisturizer",
      expectedSource: "verified_knowledge",
      expectedRoutineSelected: false,
      expectation: "verified role 可以增强并覆盖 fallback，但不会绕过 AM 的 role-necessity gate。",
    }),
    validateCase({
      code: "UNKNOWN_IDENTITY_REMAINS_USABLE",
      identityStatus: "unknown",
      productType: "cleanser",
      catalogProductId: null,
      knowledge: null,
      expectedRole: "cleanser",
      expectedSource: "product_type_fallback",
      expectedRoutineSelected: true,
      expectation: "unknown identity 仍可管理和生成方案，且不产生虚假 Knowledge。",
    }),
  ];

  return {
    schema_version: DATA_BOUNDARY_VALIDATION_VERSION,
    all_passed: cases.every((item) => item.passed),
    boundaries: {
      user_asset: "products + user_owned_products record what the user owns; Catalog is optional.",
      external_fact: "facts.json records provider facts and never enters Routine directly.",
      beauty_os_knowledge: "Only verified roles/capabilities may enhance Resolver decisions.",
    },
    cases,
  };
}

function validateCase(input: {
  code: DataBoundaryValidationCase["code"];
  identityStatus: "matched" | "unknown";
  productType: "moisturizer" | "serum" | "cleanser";
  catalogProductId: string | null;
  knowledge: ProductKnowledgeSnapshot | null;
  expectedRole: string;
  expectedSource: ProductDecisionProfile["primary_role_source"];
  expectedRoutineSelected: boolean;
  expectation: string;
}): DataBoundaryValidationCase {
  const productId = productIdFor(input.code);
  const profile = resolveProductDecisionProfile({
    product: {
      id: productId,
      product_type: input.productType,
      catalog_product_id: input.catalogProductId,
    },
    knowledge: input.knowledge,
  });
  const plan = buildRoutinePlan({
    routineDate: "2026-08-25",
    period: input.expectedRole === "cleanser" ? "pm" : "am",
    checkin: null,
    weather: null,
    decisionProfilesByProductId: new Map([[productId, profile]]),
    products: [ownedProduct({
      productId,
      productType: input.productType,
      catalogProductId: input.catalogProductId,
      identityStatus: input.identityStatus,
    })],
    feedbackStats: new Map(),
    maxSteps: 5,
  });
  const step = plan.steps[0] ?? null;
  const falseKnowledgeGenerated = input.knowledge === null
    && profile.knowledge_status !== "unknown";
  const routineSelected = step !== null;
  const passed = (step?.role ?? profile.primary_role) === input.expectedRole
    && profile.primary_role_source === input.expectedSource
    && routineSelected === input.expectedRoutineSelected
    && !falseKnowledgeGenerated;

  return {
    code: input.code,
    passed,
    identity_status: input.identityStatus,
    catalog_product_id: input.catalogProductId,
    knowledge_status: profile.knowledge_status,
    role: step?.role ?? profile.primary_role,
    role_source: profile.primary_role_source,
    routine_selected: routineSelected,
    false_knowledge_generated: falseKnowledgeGenerated,
    expectation: input.expectation,
  };
}

const CATALOG_ID = "10000000-0000-4000-8000-000000000001";

function productIdFor(code: DataBoundaryValidationCase["code"]) {
  const suffix = {
    NO_CATALOG_FALLBACK: "1",
    CATALOG_WITHOUT_VERIFIED_KNOWLEDGE: "2",
    VERIFIED_KNOWLEDGE_ENHANCEMENT: "3",
    UNKNOWN_IDENTITY_REMAINS_USABLE: "4",
  }[code];
  return `20000000-0000-4000-8000-00000000000${suffix}`;
}

function knowledgeSnapshot(options: { verifiedRole?: string } = {}): ProductKnowledgeSnapshot {
  return {
    identity: {
      catalog_product_id: CATALOG_ID,
      brand_name: "Boundary",
      product_name: "Validation Product",
      variant_name: null,
      barcode: null,
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      primary_source_id: "30000000-0000-4000-8000-000000000001",
      identity_confidence: 95,
      catalog_status: "verified",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
    },
    care_roles: options.verifiedRole ? [{
      assignment_id: "40000000-0000-4000-8000-000000000001",
      care_role_code: options.verifiedRole,
      display_name: options.verifiedRole,
      definition: "Boundary validation role.",
      definition_version: 1,
      assignment_kind: "primary",
      status: "verified",
      confidence: 95,
      assessment_note: "Boundary validation fixture.",
      source_locator: "https://example.com/boundary-validation",
      reviewed_at: "2026-08-25T00:00:00.000Z",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
    }] : [],
    capabilities: [],
  };
}

function ownedProduct(input: {
  productId: string;
  productType: string;
  catalogProductId: string | null;
  identityStatus: "matched" | "unknown";
}) {
  return {
    id: input.productId,
    user_id: "00000000-0000-4000-8000-000000000001",
    product_id: input.productId,
    status: "active",
    purchase_date: null,
    opened_at: null,
    expires_on: null,
    quantity_remaining_percent: 100,
    notes: null,
    archived_at: null,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
    product: {
      id: input.productId,
      brand_name: "Boundary",
      product_name: "Validation Product",
      variant_name: null,
      barcode: null,
      identity_status: input.identityStatus,
      category: "skincare",
      subcategory: "face_care",
      product_type: input.productType,
      catalog_product_id: input.catalogProductId,
      created_by_user_id: "00000000-0000-4000-8000-000000000001",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
    },
  };
}
