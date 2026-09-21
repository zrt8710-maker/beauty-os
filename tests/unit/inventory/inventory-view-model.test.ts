import { describe, expect, it } from "vitest";

import {
  ASSET_SECTIONS,
  filterInventoryBySection,
  getAssetSection,
  getAssetSectionCounts,
  getExpiryInformationHint,
  getOwnedProductImageUploads,
  getProductTypesForAssetSection,
  getStoredCategoryForProductType,
  groupInventoryByBrand,
  preserveOwnedProductImagePresentation,
  synchronizeInventoryImagePresentation,
} from "@/features/inventory/inventory-view-model";
import { expiryMessage } from "@/features/inventory/inventory-manager";
import type { OwnedProduct, Product } from "@/schemas/product";
import type { UploadAsset } from "@/schemas/upload";

describe("inventory view model", () => {
  it("将所有产品映射到唯一的一级资产分类", () => {
    expect(getAssetSection(owned("serum", "skincare"))).toBe("skincare");
    expect(getAssetSection(owned("foundation", "makeup"))).toBe("makeup");
    expect(getAssetSection(owned("cleanser", "skincare"))).toBe("cleansing");
    expect(getAssetSection(owned("makeup_remover", "skincare"))).toBe("cleansing");
    expect(getAssetSection(owned("body_cleanser", "bodycare"))).toBe("cleansing");
    expect(getAssetSection(owned("shampoo", "haircare"))).toBe("cleansing");
    expect(getAssetSection(owned("perfume", "fragrance"))).toBe("other");
  });

  it("用户私有资产分类优先于公共产品分类", () => {
    const item = { ...owned("serum", "skincare"), asset_category: "other" as const };

    expect(getAssetSection(item)).toBe("other");
    expect(filterInventoryBySection([item], "skincare")).toEqual([]);
    expect(filterInventoryBySection([item], "other")).toEqual([item]);
  });

  it("分类计数和列表筛选都保留全部非归档产品记录", () => {
    const inventory = [
      owned("serum", "skincare"),
      owned("foundation", "makeup"),
      owned("cleanser", "skincare"),
      owned("body_lotion", "bodycare", "finished"),
    ];

    expect(getAssetSectionCounts(inventory)).toEqual({
      skincare: 1,
      makeup: 1,
      cleansing: 1,
      other: 1,
    });
    expect(filterInventoryBySection(inventory, "other")).toEqual([
      inventory[3],
    ]);
    expect(ASSET_SECTIONS.flatMap((section) => filterInventoryBySection(inventory, section)))
      .toHaveLength(inventory.length);
  });

  it("展示层把重复品牌独立分组，并将单件和无品牌资产稳定归入其他品牌", () => {
    const one = withBrand(owned("serum", "skincare"), "溪木源", "one");
    const singleton = withBrand(owned("toner", "skincare"), "城野医生", "singleton");
    const two = withBrand(owned("moisturizer", "skincare"), "溪木源", "two");
    const unbranded = withBrand(owned("sunscreen", "skincare"), null, "unbranded");

    expect(groupInventoryByBrand([one, singleton, two, unbranded])).toEqual([
      {
        key: "brand:溪木源",
        label: "溪木源",
        products: [one, two],
        isOtherBrands: false,
      },
      {
        key: "other-brands",
        label: "其他品牌",
        products: [singleton, unbranded],
        isOtherBrands: true,
      },
    ]);
  });

  it("资产分类筛选具体类型，并由具体类型保留原始数据库分类", () => {
    const cleansingTypes = getProductTypesForAssetSection("cleansing").map(
      ([type]) => type,
    );
    const otherTypes = getProductTypesForAssetSection("other").map(([type]) => type);

    expect(cleansingTypes).toEqual([
      "makeup_remover",
      "cleanser",
      "body_cleanser",
      "shampoo",
    ]);
    expect(otherTypes).toContain("perfume");
    expect(otherTypes).toContain("device");
    expect(getStoredCategoryForProductType("shampoo")).toBe("haircare");
    expect(getStoredCategoryForProductType("body_cleanser")).toBe("bodycare");
  });

  it("到期日未设置时仅给出轻量提示", () => {
    expect(getExpiryInformationHint({ expires_on: null })).toBe(
      "设置到期日期，更方便管理这件产品。",
    );
    expect(getExpiryInformationHint({ expires_on: "2027-08-25" })).toBeNull();
    expect(expiryMessage(null).label).toBe("未设置到期日");
    expect(expiryMessage(null).tone).toBe("text-muted-foreground");
  });

  it("资产图片列表同时包含资产专属上传和合法 legacy 上传", () => {
    const item = owned("serum", "skincare");
    const assetUpload = upload({ owned_product_id: item.id });
    const legacyUpload = upload({
      id: "30000000-0000-4000-8000-000000000002",
      product_id: item.product_id,
    });
    const otherAssetUpload = upload({
      id: "30000000-0000-4000-8000-000000000003",
      owned_product_id: "20000000-0000-4000-8000-000000000099",
    });

    expect(getOwnedProductImageUploads(item, [assetUpload, legacyUpload, otherAssetUpload]))
      .toEqual([assetUpload, legacyUpload]);
  });

  it("保存普通资产字段后保留当前已解析图片展示", () => {
    const current = {
      ...owned("serum", "skincare"),
      product: {
        ...owned("serum", "skincare").product,
        catalog_image_url: "https://catalog.example/product.jpg",
      },
      image: {
        resolved_url: "https://storage.example/mine.jpg",
        source: "user_override" as const,
        has_override: true,
      },
    };
    const saved = {
      ...current,
      quantity_remaining_percent: 40,
      product: { ...current.product, catalog_image_url: undefined },
      image: { resolved_url: null, source: "none" as const, has_override: true },
    };

    expect(preserveOwnedProductImagePresentation(current, saved)).toMatchObject({
      quantity_remaining_percent: 40,
      product: { catalog_image_url: "https://catalog.example/product.jpg" },
      image: current.image,
    });
  });

  it("服务端刷新时只同步权威图片字段，不覆盖本地资产编辑状态", () => {
    const current = {
      ...owned("serum", "skincare"),
      quantity_remaining_percent: 35,
      notes: "尚未保存的本地备注",
      image: { resolved_url: null, source: "none" as const, has_override: false },
    };
    const server = {
      ...current,
      quantity_remaining_percent: 100,
      notes: "服务端旧备注",
      product: {
        ...current.product,
        catalog_image_url: "https://catalog.example/latest.jpg",
      },
      image: {
        resolved_url: "https://catalog.example/latest.jpg",
        source: "catalog" as const,
        has_override: false,
      },
    };

    expect(synchronizeInventoryImagePresentation([current], [server])[0]).toMatchObject({
      quantity_remaining_percent: 35,
      notes: "尚未保存的本地备注",
      product: { catalog_image_url: "https://catalog.example/latest.jpg" },
      image: server.image,
    });
  });
});

function upload(patch: Partial<UploadAsset> = {}): UploadAsset {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    product_id: null,
    owned_product_id: null,
    file_name: "product.jpg",
    mime_type: "image/jpeg",
    file_size: 100,
    purpose: "product_image",
    status: "ready",
    created_at: "2026-08-19T00:00:00.000Z",
    signed_url: "https://storage.example/product.jpg",
    ...patch,
  };
}

function owned(
  productType: Product["product_type"],
  category: Product["category"],
  status: OwnedProduct["status"] = "active",
): OwnedProduct {
  const baseProduct: Product = {
    id: `10000000-0000-4000-8000-00000000000${productType.length % 10}`,
    brand_name: null,
    product_name: productType,
    variant_name: null,
    barcode: null,
    identity_status: "unknown",
    category,
    subcategory: category === "makeup" ? "base_makeup" : "other",
    product_type: productType,
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-19T00:00:00.000Z",
  };

  return {
    id: `20000000-0000-4000-8000-00000000000${productType.length % 10}`,
    product_id: baseProduct.id,
    status,
    purchase_date: null,
    opened_at: null,
    expires_on: null,
    quantity_remaining_percent: 100,
    notes: null,
    archived_at: null,
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-19T00:00:00.000Z",
    product: baseProduct,
  };
}

function withBrand(
  item: OwnedProduct,
  brandName: string | null,
  idSuffix: string,
): OwnedProduct {
  return {
    ...item,
    id: `${item.id}-${idSuffix}`,
    product: { ...item.product, brand_name: brandName },
  };
}
