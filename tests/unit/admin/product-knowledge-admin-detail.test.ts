import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminProductKnowledgeOverview } from "@/server/services/admin-product-knowledge-overview-service";
import { productResearchDraftFixture } from "../../support/product-research-draft-fixture";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  requireAdminPageAccess: vi.fn(),
}));

vi.mock("@/server/admin/require-admin-page-access", () => ({
  requireAdminPageAccess: mocks.requireAdminPageAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/server/repositories/catalog-identity-repository", () => ({
  createCatalogIdentityRepository: () => ({}),
}));
vi.mock("@/server/repositories/knowledge-repository", () => ({ createKnowledgeRepository: () => ({}) }));
vi.mock("@/server/repositories/product-research-draft-repository", () => ({
  createProductResearchDraftRepository: () => ({}),
}));
vi.mock("@/server/services/admin-product-knowledge-overview-service", () => ({
  createAdminProductKnowledgeOverviewService: () => ({ get: mocks.get }),
}));
vi.mock("@/features/admin/product-knowledge-research-button", () => ({
  ProductKnowledgeResearchButton: () => null,
}));
vi.mock("@/features/admin/product-knowledge-maintenance-form", () => ({
  ProductKnowledgeMaintenanceForm: ({ snapshot }: { snapshot: unknown }) => `maintenance:${snapshot ? "snapshot" : "empty"}`,
}));
vi.mock("@/features/admin/catalog-product-image-maintenance", () => ({
  CatalogProductImageMaintenance: ({ initialImageUrl }: { initialImageUrl: string | null }) => `catalog-image:${initialImageUrl ?? "placeholder"}`,
}));

import ProductKnowledgeAdminDetailPage from "@/app/(app)/admin/knowledge/products/[catalogProductId]/page";

const catalogProductId = "10000000-0000-4000-8000-000000000001";

describe("Product Knowledge admin detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminPageAccess.mockResolvedValue({ id: "admin" });
  });

  it("shows a confirmed candidate before Agent3 finishes", async () => {
    mocks.get.mockResolvedValue(overview(null));
    const html = renderToStaticMarkup(await ProductKnowledgeAdminDetailPage({
      params: Promise.resolve({ catalogProductId }),
    }));

    expect(html).toContain("HFP · 果酸毛孔净透精华水");
    expect(html).toContain("身份已确认");
    expect(html).toContain("资料完整度");
    expect(html).toContain("产品身份");
    expect(html).toContain("知识待补充");
    expect(html).toContain("maintenance:empty");
    expect(html).toContain("catalog-image:placeholder");
    expect(html).toContain("重新研究");
    expect(html).not.toContain("Submit for review");
    expect(html).not.toContain("Publish Verified Knowledge");
  });

  it("shows a low-confidence draft as current knowledge without approval", async () => {
    const draft = productResearchDraftFixture({ status: "draft", overall_confidence: 30 });
    mocks.get.mockResolvedValue(overview(draft));
    const html = renderToStaticMarkup(await ProductKnowledgeAdminDetailPage({
      params: Promise.resolve({ catalogProductId }),
    }));

    expect(html).toContain("Today 可用");
    expect(html).toContain("整体可信度");
    expect(html).toContain(">30<");
    expect(html).toContain("maintenance:snapshot");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Reject");
    expect(html).not.toContain("Publish Verified Knowledge");
    expect(html).not.toContain("发布到 Today Runtime");
  });

  it("keeps the research draft visible when the formal ingredient relation is unavailable", async () => {
    const draft = productResearchDraftFixture({ status: "approved" });
    mocks.get.mockResolvedValue({
      ...overview(draft),
      formalIngredientReadError: {
        code: "PGRST200",
        message: "relation unavailable",
        details: "schema cache",
        hint: "reload schema",
      },
    });
    const html = renderToStaticMarkup(await ProductKnowledgeAdminDetailPage({
      params: Promise.resolve({ catalogProductId }),
    }));

    expect(html).toContain("正式成分关系暂时无法读取");
    expect(html).toContain("maintenance:snapshot");
    expect(html).not.toContain("relation unavailable");
  });
});

function overview(
  latestSnapshot: ReturnType<typeof productResearchDraftFixture> | null,
): AdminProductKnowledgeOverview {
  return {
    product: {
      id: catalogProductId,
      brand_name: "HFP",
      product_name: "果酸毛孔净透精华水",
      variant_name: null,
      barcode: null,
      category: null,
      subcategory: null,
      product_type: null,
      confidence: 92,
      status: "candidate",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    },
    identity_status: "confirmed",
    runtime_verified: false,
    knowledge_status: latestSnapshot ? "research_available" : "not_researched",
    overall_confidence: latestSnapshot?.overall_confidence ?? null,
    latest_snapshot: latestSnapshot,
    formalIngredientReadError: null,
    completeness: {
      overall: latestSnapshot ? "usable" : "incomplete",
      fields: {
        identity: "complete", variant: "missing", product_type: "missing", ingredients: "missing",
        claims: "missing", texture: "missing", usage: "missing", cautions: "missing", uncertainties_conflicts: "missing",
      },
      source_quality: "unknown",
      suggested_actions: ["rerun_research"],
    },
    updated_at: latestSnapshot?.updated_at ?? "2026-08-28T00:00:00.000Z",
  };
}
