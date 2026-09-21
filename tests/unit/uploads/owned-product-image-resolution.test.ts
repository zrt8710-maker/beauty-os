import { describe, expect, it } from "vitest";

import { resolveOwnedProductImage } from "@/server/services/upload-service";
import type { OwnedProduct } from "@/schemas/product";
import type { UploadAsset } from "@/schemas/upload";

const owned = (patch: Partial<OwnedProduct> = {}): OwnedProduct => ({
  id: "10000000-0000-4000-8000-000000000001",
  product_id: "20000000-0000-4000-8000-000000000001",
  status: "unopened", purchase_date: null, opened_at: null, expires_on: null,
  quantity_remaining_percent: 100, notes: null, archived_at: null,
  created_at: "2026-08-26T00:00:00.000Z", updated_at: "2026-08-26T00:00:00.000Z",
  product: { id: "20000000-0000-4000-8000-000000000001", brand_name: "品牌", product_name: "产品", variant_name: null, barcode: null, identity_status: "unknown", category: "skincare", subcategory: "face_care", product_type: "serum", created_at: "2026-08-26T00:00:00.000Z", updated_at: "2026-08-26T00:00:00.000Z" },
  image: { resolved_url: null, source: "none", has_override: false },
  ...patch,
});

const upload = (patch: Partial<UploadAsset> = {}): UploadAsset => ({
  id: "30000000-0000-4000-8000-000000000001", product_id: null, owned_product_id: null,
  file_name: "image.png", mime_type: "image/png", file_size: 1, purpose: "product_image",
  status: "ready", created_at: "2026-08-26T00:00:00.000Z", signed_url: "https://storage.example/image",
  ...patch,
});

describe("owned product image resolution", () => {
  it("uses placeholder when no image exists", () => {
    expect(resolveOwnedProductImage(owned(), []).image).toEqual({ resolved_url: null, source: "none", has_override: false });
  });

  it("uses identified image when present", () => {
    expect(resolveOwnedProductImage(owned({ identified_image_url: "https://source.example/product.jpg" }), []).image!.source).toBe("identified");
  });

  it("prefers the asset-specific override over identified image", () => {
    const asset = owned({ identified_image_url: "https://source.example/product.jpg", image_override_upload_id: "30000000-0000-4000-8000-000000000001" });
    expect(resolveOwnedProductImage(asset, [upload({ owned_product_id: asset.id })]).image).toMatchObject({ source: "user_override", has_override: true });
  });

  it("falls back to identified image after an override is cleared", () => {
    expect(resolveOwnedProductImage(owned({ identified_image_url: "https://source.example/product.jpg" }), [upload()]).image!.source).toBe("identified");
  });

  it("keeps legacy product uploads distinct from asset overrides", () => {
    const asset = owned();
    expect(resolveOwnedProductImage(asset, [upload({ product_id: asset.product_id })]).image).toMatchObject({ source: "legacy", has_override: false });
  });

  it("uses the current Catalog image when the asset has no image", () => {
    const asset = owned({ product: { ...owned().product, catalog_image_url: "https://catalog.example/current.jpg" } });
    expect(resolveOwnedProductImage(asset, []).image).toEqual({
      resolved_url: "https://catalog.example/current.jpg",
      source: "catalog",
      has_override: false,
    });
  });

  it("keeps only a valid user override ahead of the Catalog image", () => {
    const withCatalog = { ...owned().product, catalog_image_url: "https://catalog.example/product.jpg" };
    const override = owned({ product: withCatalog, image_override_upload_id: "30000000-0000-4000-8000-000000000001" });
    expect(resolveOwnedProductImage(override, [upload({ owned_product_id: override.id })]).image!.source).toBe("user_override");
    expect(resolveOwnedProductImage(owned({ product: withCatalog, identified_image_url: "https://source.example/product.jpg" }), []).image!.source).toBe("catalog");
    expect(resolveOwnedProductImage(owned({ product: withCatalog }), [upload({ product_id: owned().product_id })]).image!.source).toBe("catalog");
  });

  it("falls back to the Catalog image when a configured override is broken", () => {
    const asset = owned({
      product: { ...owned().product, catalog_image_url: "https://catalog.example/product.jpg" },
      image_override_upload_id: "30000000-0000-4000-8000-000000000001",
    });
    expect(resolveOwnedProductImage(asset, []).image).toEqual({
      resolved_url: "https://catalog.example/product.jpg",
      source: "catalog",
      has_override: true,
    });
  });

  it("falls back from Catalog to identified image and then legacy upload", () => {
    expect(resolveOwnedProductImage(owned({ identified_image_url: "https://source.example/product.jpg" }), []).image!.source).toBe("identified");
    const asset = owned();
    expect(resolveOwnedProductImage(asset, [upload({ product_id: asset.product_id })]).image!.source).toBe("legacy");
  });

  it("keeps overrides separate for two assets of the same product", () => {
    const first = owned({ image_override_upload_id: "30000000-0000-4000-8000-000000000001" });
    const second = owned({ id: "10000000-0000-4000-8000-000000000002", image_override_upload_id: "30000000-0000-4000-8000-000000000002" });
    const images = [
      upload({ owned_product_id: first.id, signed_url: "https://storage.example/first" }),
      upload({ id: "30000000-0000-4000-8000-000000000002", owned_product_id: second.id, signed_url: "https://storage.example/second" }),
    ];
    expect(resolveOwnedProductImage(first, images).image!.resolved_url).toBe("https://storage.example/first");
    expect(resolveOwnedProductImage(second, images).image!.resolved_url).toBe("https://storage.example/second");
  });
});
