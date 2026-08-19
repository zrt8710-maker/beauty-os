import { describe, expect, it, vi } from "vitest";

import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createKnowledgeService } from "@/server/services/knowledge-service";

const source = { id: "10000000-0000-4000-8000-000000000001", source_type: "official_brand", name: "Official Brand", source_url: "https://example.com/product", license_note: null, retrieved_at: "2026-08-18T00:00:00.000Z", created_at: "2026-08-18T00:00:00.000Z" };
const product = { id: "20000000-0000-4000-8000-000000000001", brand_name: "Beauty", product_name: "Daily SPF", variant_name: null, barcode: null, category: "skincare", subcategory: "sun_care", product_type: "sunscreen", primary_source_id: source.id, confidence: 95, status: "verified", created_at: source.created_at, updated_at: source.created_at, source };
const ingredient = { id: "30000000-0000-4000-8000-000000000001", inci_name: "AQUA", display_name: "Water", aliases: ["Water"], ingredient_kind: "solvent", created_at: source.created_at, updated_at: source.created_at };

describe("KnowledgeService", () => {
  it("只返回已验证产品的来源与成分关系", async () => {
    const repository: KnowledgeRepository = { listVerifiedProducts: vi.fn().mockResolvedValue([product]), findVerifiedProduct: vi.fn().mockResolvedValue(product), listVerifiedProductIngredients: vi.fn().mockResolvedValue([{ catalog_product_id: product.id, ingredient_id: ingredient.id, ingredient_order: 1, source_id: source.id, confidence: 90, evidence_note: "官方成分表", ingredient, source }]), findVerifiedByBarcode: vi.fn(), listVerifiedProductsForMatching: vi.fn() };
    const service = createKnowledgeService(repository);
    const list = await service.listProducts({});
    const details = await service.getProductIngredients(product.id);
    expect(list[0].status).toBe("verified");
    expect(list[0].source.name).toBe("Official Brand");
    expect(details.ingredients[0]).toEqual(expect.objectContaining({ ingredient: expect.objectContaining({ inci_name: "AQUA" }), source: expect.objectContaining({ id: source.id }) }));
  });

  it("不接受非法查询与产品标识", async () => {
    const repository = { listVerifiedProducts: vi.fn(), findVerifiedProduct: vi.fn(), listVerifiedProductIngredients: vi.fn() } as unknown as KnowledgeRepository;
    const service = createKnowledgeService(repository);
    await expect(service.listProducts({ limit: 99 })).rejects.toThrow();
    await expect(service.getProductIngredients("not-a-uuid")).rejects.toThrow();
  });
});
