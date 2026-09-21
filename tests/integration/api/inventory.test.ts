import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OwnedProductRepository } from "@/server/repositories/owned-product-repository";
import type { ProductRepository } from "@/server/repositories/product-repository";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  createProductRepository: vi.fn(),
  createOwnedProductRepository: vi.fn(),
  createUploadRepository: vi.fn(),
  createProductImageStorage: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/auth/get-current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/server/repositories/product-repository", () => ({
  createProductRepository: mocks.createProductRepository,
}));
vi.mock("@/server/repositories/owned-product-repository", () => ({
  createOwnedProductRepository: mocks.createOwnedProductRepository,
}));
vi.mock("@/server/repositories/upload-repository", () => ({
  createUploadRepository: mocks.createUploadRepository,
}));
vi.mock("@/server/integrations/storage/product-images", () => ({
  createProductImageStorage: mocks.createProductImageStorage,
}));

import { GET as getOwnedProducts, POST as postOwnedProduct } from "@/app/api/v1/owned-products/route";
import {
  DELETE as deleteOwnedProduct,
  PATCH as patchOwnedProduct,
} from "@/app/api/v1/owned-products/[id]/route";
import { GET as getProducts, POST as postProduct } from "@/app/api/v1/products/route";

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
  purchase_date: null,
  opened_at: null,
  quantity_remaining_percent: 50,
  notes: null,
  archived_at: null,
  created_at: "2026-08-18T01:00:00.000Z",
  updated_at: "2026-08-18T01:00:00.000Z",
  product: productRow,
};

describe("inventory API", () => {
  let products: ProductRepository;
  let ownedProducts: OwnedProductRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    products = {
      listByUserId: vi.fn().mockResolvedValue([productRow]),
      findById: vi.fn().mockResolvedValue(productRow),
      create: vi.fn().mockResolvedValue(productRow),
    };
    ownedProducts = {
      listByUserId: vi.fn().mockResolvedValue([ownedRow]),
      listByUserIdWithCatalogImage: vi.fn().mockResolvedValue([ownedRow]),
      findById: vi.fn().mockResolvedValue(ownedRow),
      create: vi.fn().mockResolvedValue(ownedRow),
      update: vi.fn().mockResolvedValue(ownedRow),
      archive: vi.fn().mockResolvedValue({
        ...ownedRow,
        status: "archived",
        archived_at: "2026-08-18T02:00:00.000Z",
      }),
    };
    mocks.createClient.mockResolvedValue({});
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a", email: "a@example.com" });
    mocks.createProductRepository.mockReturnValue(products);
    mocks.createOwnedProductRepository.mockReturnValue(ownedProducts);
    mocks.createUploadRepository.mockReturnValue({
      listByUserId: vi.fn().mockResolvedValue([]),
    });
    mocks.createProductImageStorage.mockReturnValue({});
  });

  it("用户可以创建自己的产品", async () => {
    const response = await postProduct(
      jsonRequest("http://localhost/api/v1/products", "POST", {
        brand_name: "Beauty OS",
        product_name: "保湿精华",
        category: "skincare",
        product_type: "serum",
      }),
    );

    expect(response.status).toBe(201);
    expect(products.create).toHaveBeenCalledWith("user-a", expect.any(Object));
  });

  it("用户可以查看自己的产品和库存", async () => {
    const [productsResponse, ownedResponse] = await Promise.all([
      getProducts(new Request("http://localhost/api/v1/products")),
      getOwnedProducts(new Request("http://localhost/api/v1/owned-products")),
    ]);

    expect(productsResponse.status).toBe(200);
    expect(ownedResponse.status).toBe(200);
    expect(products.listByUserId).toHaveBeenCalledWith("user-a", {
      category: undefined,
      search: undefined,
    });
    expect(ownedProducts.listByUserIdWithCatalogImage).toHaveBeenCalledWith("user-a", {
      status: undefined,
    });
  });

  it("查询参数不能切换到其他用户", async () => {
    await getProducts(
      new Request("http://localhost/api/v1/products?user_id=user-b"),
    );

    expect(products.listByUserId).toHaveBeenCalledWith(
      "user-a",
      expect.any(Object),
    );
    expect(products.listByUserId).not.toHaveBeenCalledWith(
      "user-b",
      expect.any(Object),
    );
  });

  it("用户不能修改或归档其他用户的库存", async () => {
    vi.mocked(ownedProducts.findById).mockResolvedValue(null);
    vi.mocked(ownedProducts.archive).mockResolvedValue(null);
    const routeContext = {
      params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000002" }),
    };

    const patchResponse = await patchOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/other", "PATCH", {
        quantity_remaining_percent: 20,
      }),
      routeContext,
    );
    const deleteResponse = await deleteOwnedProduct(
      new Request("http://localhost/api/v1/owned-products/other", {
        method: "DELETE",
      }),
      routeContext,
    );

    expect(patchResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
    expect(ownedProducts.update).not.toHaveBeenCalled();
    expect(ownedProducts.findById).toHaveBeenCalledWith(
      "user-a",
      "20000000-0000-4000-8000-000000000002",
    );
    expect(ownedProducts.archive).toHaveBeenCalledWith(
      "user-a",
      "20000000-0000-4000-8000-000000000002",
      expect.any(String),
    );
  });

  it("非法产品和库存输入被 Zod 拒绝", async () => {
    const productResponse = await postProduct(
      jsonRequest("http://localhost/api/v1/products", "POST", {
        product_name: "错误粉底",
        brand_name: null,
        category: "skincare",
        product_type: "foundation",
        created_by_user_id: "user-b",
      }),
    );
    const ownedResponse = await postOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products", "POST", {
        product_id: productRow.id,
        status: "active",
        purchase_date: null,
        opened_at: null,
        quantity_remaining_percent: 101,
        notes: null,
      }),
    );

    expect(productResponse.status).toBe(400);
    expect(ownedResponse.status).toBe(400);
    expect(products.create).not.toHaveBeenCalled();
    expect(ownedProducts.create).not.toHaveBeenCalled();
  });

  it("未登录请求不能访问资产 API", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await getProducts(
      new Request("http://localhost/api/v1/products"),
    );

    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
