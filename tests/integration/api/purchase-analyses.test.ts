import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseAnalysisNotFoundError } from "@/server/services/purchase-analysis-service";

const mocks = vi.hoisted(() => ({ getContext: vi.fn() }));
vi.mock("@/server/purchase-analysis/get-purchase-analysis-request-context", () => ({ getPurchaseAnalysisRequestContext: mocks.getContext }));

import { GET as getAnalysis } from "@/app/api/v1/purchase-analyses/[id]/route";
import { GET as listAnalyses, POST as createAnalysis } from "@/app/api/v1/purchase-analyses/route";

const analysisId = "60000000-0000-4000-8000-000000000001";
describe("purchase analyses API", () => {
  const service = { analyze: vi.fn(), list: vi.fn(), get: vi.fn() };
  beforeEach(() => { vi.clearAllMocks(); mocks.getContext.mockResolvedValue({ user: { id: "user-a" }, service }); service.analyze.mockResolvedValue({ id: analysisId }); service.list.mockResolvedValue([]); service.get.mockResolvedValue({ id: analysisId }); });
  it("创建分析只使用 session 用户", async () => {
    const response = await createAnalysis(jsonRequest({ candidate_snapshot: { brand_name: null, product_name: "Serum", category: "skincare", product_type: "serum", ingredients: [] } }));
    expect(response.status).toBe(201); expect(service.analyze).toHaveBeenCalledWith("user-a", expect.anything());
  });
  it("列表和详情都限定当前用户", async () => {
    expect((await listAnalyses(new Request("http://localhost/api/v1/purchase-analyses"))).status).toBe(200);
    expect((await getAnalysis(new Request("http://localhost"), { params: Promise.resolve({ id: analysisId }) })).status).toBe(200);
    expect(service.list).toHaveBeenCalledWith("user-a", expect.anything()); expect(service.get).toHaveBeenCalledWith("user-a", analysisId);
  });
  it("其他用户分析在当前用户上下文中表现为不存在", async () => {
    service.get.mockRejectedValueOnce(new PurchaseAnalysisNotFoundError("PURCHASE_ANALYSIS_NOT_FOUND"));
    const response = await getAnalysis(new Request("http://localhost"), { params: Promise.resolve({ id: analysisId }) });
    expect(response.status).toBe(404);
  });
  it("未登录不能访问", async () => { mocks.getContext.mockResolvedValue(null); expect((await listAnalyses(new Request("http://localhost/api/v1/purchase-analyses"))).status).toBe(401); });
});
function jsonRequest(body: unknown) { return new Request("http://localhost/api/v1/purchase-analyses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
