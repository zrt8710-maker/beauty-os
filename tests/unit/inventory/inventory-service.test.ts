import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OwnedProductRepository } from "@/server/repositories/owned-product-repository";
import type { ProductRepository } from "@/server/repositories/product-repository";
import {
  InventoryNotFoundError,
  createInventoryService,
} from "@/server/services/inventory-service";

const productRow = {
  id: "10000000-0000-4000-8000-000000000001",
  brand_name: "Beauty OS",
  product_name: "保湿精华",
  category: "skincare",
  subcategory: "face_care",
  product_type: "serum",
  created_by_user_id: "user-a",
  created_at: "2026-08-18T01:00:00.000Z",
  updated_at: "2026-08-18T01:00:00.000Z",
};

const ownedRow = {
  id: "20000000-0000-4000-8000-000000000001",
  user_id: "user-a",
  product_id: productRow.id,
  status: "active",
  purchase_date: "2026-08-01",
  opened_at: "2026-08-10",
  quantity_remaining_percent: 60,
  notes: null,
  archived_at: null,
  created_at: "2026-08-18T01:00:00.000Z",
  updated_at: "2026-08-18T01:00:00.000Z",
  product: productRow,
};

describe("InventoryService", () => {
  let products: ProductRepository;
  let ownedProducts: OwnedProductRepository;

  beforeEach(() => {
    products = {
      listByUserId: vi.fn().mockResolvedValue([productRow]),
      findById: vi.fn().mockResolvedValue(productRow),
      create: vi.fn().mockResolvedValue(productRow),
    };
    ownedProducts = {
      listByUserId: vi.fn().mockResolvedValue([ownedRow]),
      findById: vi.fn().mockResolvedValue(ownedRow),
      create: vi.fn().mockResolvedValue(ownedRow),
      update: vi.fn().mockResolvedValue(ownedRow),
      archive: vi.fn().mockResolvedValue({
        ...ownedRow,
        status: "archived",
        archived_at: "2026-08-18T02:00:00.000Z",
      }),
    };
  });

  it("为当前用户创建产品，并由产品类型推导 subcategory", async () => {
    const service = createInventoryService(products, ownedProducts);

    await service.createProduct("user-a", {
      brand_name: "Beauty OS",
      product_name: "保湿精华",
      category: "skincare",
      product_type: "serum",
    });

    expect(products.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        category: "skincare",
        subcategory: "face_care",
        product_type: "serum",
      }),
    );
  });

  it("只以当前 session userId 查询产品和库存", async () => {
    const service = createInventoryService(products, ownedProducts);

    await service.listProducts("user-a", {});
    await service.listOwnedProducts("user-a", {});

    expect(products.listByUserId).toHaveBeenCalledWith("user-a", {});
    expect(ownedProducts.listByUserId).toHaveBeenCalledWith("user-a", {});
  });

  it("不能把其他用户的产品添加到自己的库存", async () => {
    vi.mocked(products.findById).mockResolvedValue(null);
    const service = createInventoryService(products, ownedProducts);

    await expect(
      service.createOwnedProduct("user-a", {
        product_id: "30000000-0000-4000-8000-000000000001",
        status: "unopened",
        purchase_date: null,
        opened_at: null,
        quantity_remaining_percent: 100,
        notes: null,
      }),
    ).rejects.toEqual(new InventoryNotFoundError("PRODUCT_NOT_FOUND"));
    expect(ownedProducts.create).not.toHaveBeenCalled();
  });

  it("找不到当前用户库存时禁止修改", async () => {
    vi.mocked(ownedProducts.findById).mockResolvedValue(null);
    const service = createInventoryService(products, ownedProducts);

    await expect(
      service.updateOwnedProduct(
        "user-a",
        "20000000-0000-4000-8000-000000000002",
        { quantity_remaining_percent: 20 },
      ),
    ).rejects.toEqual(new InventoryNotFoundError("OWNED_PRODUCT_NOT_FOUND"));
    expect(ownedProducts.update).not.toHaveBeenCalled();
  });
});
