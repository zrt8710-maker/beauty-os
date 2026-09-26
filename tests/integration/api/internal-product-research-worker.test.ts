import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createJobs: vi.fn(),
  createIdentity: vi.fn(),
  createDrafts: vi.fn(),
  createKnowledge: vi.fn(),
  createProvider: vi.fn(),
  createSearchProvider: vi.fn(),
  createTrigger: vi.fn(),
  hasCompleteEnough: vi.fn(),
  backfill: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  findById: vi.fn(),
  getLatestUsableDraft: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/server/repositories/catalog-product-research-job-repository", () => ({ createCatalogProductResearchJobRepository: mocks.createJobs }));
vi.mock("@/server/repositories/catalog-identity-repository", () => ({ createCatalogIdentityRepository: mocks.createIdentity }));
vi.mock("@/server/repositories/product-research-draft-repository", () => ({ createProductResearchDraftRepository: mocks.createDrafts }));
vi.mock("@/server/repositories/knowledge-repository", () => ({ createKnowledgeRepository: mocks.createKnowledge }));
vi.mock("@/server/product-research/volcengine-agent-plan-provider", () => ({ createConfiguredVolcengineAgentPlanProductResearchProvider: mocks.createProvider }));
vi.mock("@/server/product-search/volcengine-search-infinity-provider", () => ({ createConfiguredVolcengineSearchInfinityProvider: mocks.createSearchProvider }));
vi.mock("@/server/services/product-research-trigger-service", () => ({ createProductResearchTriggerService: mocks.createTrigger }));
vi.mock("@/server/services/effective-product-research-draft", () => ({ hasCompleteEnoughProductResearch: mocks.hasCompleteEnough }));

import { POST } from "@/app/api/internal/product-research/route";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const product = { id: catalogProductId, status: "candidate", brand_name: "Test", product_name: "Lotion", variant_name: null, barcode: null };
const job = (attempts = 1) => ({ catalogProductId, attempts, leaseToken: "lease", researchInput: null });
const request = () => new Request("http://localhost/api/internal/product-research", {
  method: "POST",
  headers: { authorization: "Bearer test-worker-secret" },
});

describe("Product Research Worker result mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRODUCT_RESEARCH_WORKER_SECRET", "test-worker-secret");
    mocks.createAdminClient.mockReturnValue({});
    mocks.createJobs.mockReturnValue({ backfill: mocks.backfill, claim: mocks.claim, finish: mocks.finish });
    mocks.createIdentity.mockReturnValue({ findById: mocks.findById });
    mocks.createDrafts.mockReturnValue({ getLatestUsableDraft: mocks.getLatestUsableDraft });
    mocks.createKnowledge.mockReturnValue({});
    mocks.createProvider.mockReturnValue({});
    mocks.createSearchProvider.mockReturnValue({});
    mocks.createTrigger.mockReturnValue({ trigger: mocks.trigger });
    mocks.backfill.mockResolvedValue(0);
    mocks.claim.mockResolvedValue(job());
    mocks.finish.mockResolvedValue(true);
    mocks.findById.mockResolvedValue(product);
    mocks.getLatestUsableDraft.mockResolvedValue(null);
    mocks.hasCompleteEnough.mockReturnValue(false);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("completes partial research only after a usable draft is persisted, without repeating research", async () => {
    const usableDraft = { id: "draft-1", status: "draft" };
    mocks.trigger.mockResolvedValue("partial");
    mocks.getLatestUsableDraft.mockResolvedValueOnce(null).mockResolvedValueOnce(usableDraft);
    mocks.claim.mockResolvedValueOnce(job()).mockResolvedValueOnce(null);

    expect((await POST(request())).status).toBe(200);
    expect(mocks.getLatestUsableDraft).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith(job(), "completed", null);
    expect(await (await POST(request())).json()).toEqual({ status: "idle" });
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    expect(mocks.createDrafts).toHaveBeenCalledTimes(1);
  });

  it("retries partial research when no usable draft exists", async () => {
    mocks.trigger.mockResolvedValue("partial");

    expect(await (await POST(request())).json()).toEqual({ status: "retry" });
    expect(mocks.getLatestUsableDraft).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith(job(), "retry", "partial");
  });

  it.each(["existing_draft", "started"] as const)("completes %s without an extra draft read", async (result) => {
    mocks.trigger.mockResolvedValue(result);

    expect(await (await POST(request())).json()).toEqual({ status: "completed" });
    expect(mocks.getLatestUsableDraft).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith(job(), "completed", null);
  });

  it("preserves the retry outcome through the fourth claim when no draft is usable", async () => {
    let nextAttempt = 0;
    let status = "queued";
    mocks.claim.mockImplementation(async () => status === "failed" ? null : job(++nextAttempt));
    mocks.trigger.mockResolvedValue("partial");
    mocks.finish.mockImplementation(async (_job, outcome, reason) => {
      status = outcome === "retry" && nextAttempt >= 4 ? "failed" : outcome;
      expect(reason).toBe("partial");
      return true;
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await (await POST(request())).json()).toEqual({ status: "retry" });
    }
    expect(status).toBe("failed");
    expect(await (await POST(request())).json()).toEqual({ status: "idle" });
    expect(mocks.trigger).toHaveBeenCalledTimes(4);
    expect(mocks.createDrafts).toHaveBeenCalledTimes(4);
  });
});
