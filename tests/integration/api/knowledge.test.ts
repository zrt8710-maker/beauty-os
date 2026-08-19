import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createClient: vi.fn(), createKnowledgeRepository: vi.fn(), createKnowledgeService: vi.fn() }));
vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/repositories/knowledge-repository", () => ({ createKnowledgeRepository: mocks.createKnowledgeRepository }));
vi.mock("@/server/services/knowledge-service", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/services/knowledge-service")>()), createKnowledgeService: mocks.createKnowledgeService }));

import { GET as listProducts } from "@/app/api/v1/knowledge/products/route";
import { GET as listIngredients } from "@/app/api/v1/knowledge/products/[id]/ingredients/route";

const productId = "20000000-0000-4000-8000-000000000001";
describe("knowledge API", () => {
  const service = { listProducts: vi.fn(), getProductIngredients: vi.fn() };
  beforeEach(() => { vi.clearAllMocks(); mocks.getCurrentUser.mockResolvedValue({ id: "user-a" }); mocks.createClient.mockResolvedValue({}); mocks.createKnowledgeRepository.mockReturnValue({}); mocks.createKnowledgeService.mockReturnValue(service); service.listProducts.mockResolvedValue([]); service.getProductIngredients.mockResolvedValue({ product: { id: productId }, ingredients: [] }); });
  it("登录用户可以读取 verified knowledge", async () => { const response = await listProducts(new Request("http://localhost/api/v1/knowledge/products")); expect(response.status).toBe(200); expect(service.listProducts).toHaveBeenCalled(); });
  it("登录用户可以读取产品成分关系", async () => { const response = await listIngredients(new Request("http://localhost"), { params: Promise.resolve({ id: productId }) }); expect(response.status).toBe(200); expect(service.getProductIngredients).toHaveBeenCalledWith(productId); });
  it("未登录用户不能读取 knowledge", async () => { mocks.getCurrentUser.mockResolvedValue(null); const response = await listProducts(new Request("http://localhost/api/v1/knowledge/products")); expect(response.status).toBe(401); expect(mocks.createClient).not.toHaveBeenCalled(); });
});
