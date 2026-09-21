import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), requireAdminPageAccess: vi.fn() }));
vi.mock("@/server/admin/require-admin-page-access", () => ({ requireAdminPageAccess: mocks.requireAdminPageAccess }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/server/repositories/catalog-identity-repository", () => ({ createCatalogIdentityRepository: () => ({}) }));
vi.mock("@/server/repositories/knowledge-repository", () => ({ createKnowledgeRepository: () => ({}) }));
vi.mock("@/server/repositories/product-research-draft-repository", () => ({ createProductResearchDraftRepository: () => ({}) }));
vi.mock("@/server/services/admin-product-knowledge-overview-service", () => ({ createAdminProductKnowledgeOverviewService: () => ({ list: mocks.list }) }));

import KnowledgeAdminPage from "@/app/(app)/admin/knowledge/page";

describe("Admin Product Knowledge page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminPageAccess.mockResolvedValue({ id: "admin" });
  });

  it("lists a candidate with no Agent3 snapshot as confirmed and not researched", async () => {
    mocks.list.mockResolvedValue([{
      product: { id: "10000000-0000-4000-8000-000000000001", brand_name: "安修泽", product_name: "油橄榄修颜舒润精华", variant_name: null },
      identity_status: "confirmed", runtime_verified: false, knowledge_status: "not_researched", overall_confidence: null, latest_snapshot: null, completeness: { overall: "incomplete", fields: {}, source_quality: "unknown", suggested_actions: ["rerun_research"] }, updated_at: "2026-08-28T00:00:00.000Z",
    }]);
    const html = renderToStaticMarkup(await KnowledgeAdminPage());

    expect(html).toContain("Product Knowledge");
    expect(html).toContain("安修泽 · 油橄榄修颜舒润精华");
    expect(html).toContain("身份已确认");
    expect(html).toContain("知识待补充");
    expect(html).toContain("资料完整度：资料不完整 · 整体可信度：—");
    expect(html).toContain("/admin/knowledge/products/10000000-0000-4000-8000-000000000001");
    expect(html).not.toContain("Research Inbox");
  });
});
