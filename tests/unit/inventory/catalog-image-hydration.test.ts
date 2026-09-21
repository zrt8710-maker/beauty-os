import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import {
  hydrateOwnedProductCatalogImages,
  mergeCatalogImages,
} from "@/server/inventory/catalog-image-hydration";
import type { OwnedProduct } from "@/schemas/product";

describe("Inventory Catalog image hydration", () => {
  it("applies the latest Catalog image by the owned product's linked Catalog ID", () => {
    const firstRead = mergeCatalogImages([ownedProduct()], [{
      id: CATALOG_ID,
      catalog_image_url: "https://catalog.example/old.jpg",
    }]);
    const secondRead = mergeCatalogImages(firstRead, [{
      id: CATALOG_ID,
      catalog_image_url: "https://catalog.example/new.jpg",
    }]);

    expect(firstRead[0]?.product.catalog_image_url).toBe("https://catalog.example/old.jpg");
    expect(secondRead[0]?.product.catalog_image_url).toBe("https://catalog.example/new.jpg");
  });

  it("does not attach an image from an unrelated Catalog product", () => {
    const result = mergeCatalogImages([ownedProduct()], [{
      id: "40000000-0000-4000-8000-000000000099",
      catalog_image_url: "https://catalog.example/unrelated.jpg",
    }]);

    expect(result[0]?.product.catalog_image_url).toBeUndefined();
  });

  it("derives IDs from owned products and selects only Catalog image fields", async () => {
    const inQuery = vi.fn().mockResolvedValue({
      data: [{ id: CATALOG_ID, catalog_image_url: "https://catalog.example/current.jpg" }],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ in: inQuery });
    const from = vi.fn().mockReturnValue({ select });

    const result = await hydrateOwnedProductCatalogImages(
      [ownedProduct()],
      { from } as unknown as SupabaseClient<Database>,
    );

    expect(from).toHaveBeenCalledWith("catalog_products");
    expect(select).toHaveBeenCalledWith("id,catalog_image_url");
    expect(inQuery).toHaveBeenCalledWith("id", [CATALOG_ID]);
    expect(result[0]?.product.catalog_image_url).toBe("https://catalog.example/current.jpg");
  });
});

const CATALOG_ID = "40000000-0000-4000-8000-000000000001";

function ownedProduct(): OwnedProduct {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    product_id: "20000000-0000-4000-8000-000000000001",
    status: "active",
    purchase_date: null,
    opened_at: null,
    expires_on: null,
    quantity_remaining_percent: 100,
    notes: null,
    archived_at: null,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
    product: {
      id: "20000000-0000-4000-8000-000000000001",
      brand_name: "品牌",
      product_name: "产品",
      variant_name: null,
      barcode: null,
      identity_status: "matched",
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      catalog_product_id: CATALOG_ID,
      created_at: "2026-09-19T00:00:00.000Z",
      updated_at: "2026-09-19T00:00:00.000Z",
    },
  };
}
