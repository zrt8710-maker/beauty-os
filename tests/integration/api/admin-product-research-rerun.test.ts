import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), createAdminClient: vi.fn(), createIdentityRepository: vi.fn(),
  createDraftRepository: vi.fn(), createKnowledgeRepository: vi.fn(), createProvider: vi.fn(), createTrigger: vi.fn(), rerun: vi.fn(),
}));

vi.mock("@/server/auth/require-admin", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/auth/require-admin")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/server/repositories/catalog-identity-repository", () => ({ createCatalogIdentityRepository: mocks.createIdentityRepository }));
vi.mock("@/server/repositories/product-research-draft-repository", () => ({ createProductResearchDraftRepository: mocks.createDraftRepository }));
vi.mock("@/server/repositories/knowledge-repository", () => ({ createKnowledgeRepository: mocks.createKnowledgeRepository }));
vi.mock("@/server/product-research/volcengine-agent-plan-provider", () => ({ createConfiguredVolcengineAgentPlanProductResearchProvider: mocks.createProvider }));
vi.mock("@/server/services/product-research-trigger-service", () => ({ createProductResearchTriggerService: mocks.createTrigger }));

import { POST } from "@/app/api/v1/admin/knowledge/products/[catalogProductId]/research/route";
import { AdminRequiredError } from "@/server/auth/require-admin";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const product = { id: catalogProductId, brand_name: "HFP", product_name: "果酸水", variant_name: null, barcode: null };
const context = { params: Promise.resolve({ catalogProductId }) };

describe("Admin Agent3 rerun API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin", appRole: "admin" });
    mocks.createAdminClient.mockReturnValue({});
    mocks.createIdentityRepository.mockReturnValue({ findById: vi.fn(async () => product) });
    mocks.createDraftRepository.mockReturnValue({}); mocks.createKnowledgeRepository.mockReturnValue({}); mocks.createProvider.mockReturnValue({});
    mocks.rerun.mockResolvedValue("started"); mocks.createTrigger.mockReturnValue({ rerun: mocks.rerun });
  });

  it("requires Admin before loading Catalog identity", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());
    expect((await POST(new Request("http://localhost"), context)).status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("loads trusted Catalog identity and explicitly reruns Agent3", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(mocks.rerun).toHaveBeenCalledWith(expect.objectContaining({ catalog_product_id: catalogProductId, brand_name: "HFP", product_name: "果酸水" }));
    await expect(response.json()).resolves.toEqual({ status: "triggered" });
  });

  it("returns 404 when the Catalog Product does not exist", async () => {
    mocks.createIdentityRepository.mockReturnValue({ findById: vi.fn(async () => null) });
    expect((await POST(new Request("http://localhost"), context)).status).toBe(404);
    expect(mocks.rerun).not.toHaveBeenCalled();
  });
});
