import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { OwnedProduct } from "@/schemas/product";

type CatalogImageRow = Pick<
  Database["public"]["Tables"]["catalog_products"]["Row"],
  "id" | "catalog_image_url"
>;

/**
 * Hydrates only Catalog images for IDs already present on authenticated,
 * user-scoped owned products. No caller-controlled Catalog IDs cross this boundary.
 */
export async function hydrateOwnedProductCatalogImages(
  ownedProducts: OwnedProduct[],
  adminSupabase: SupabaseClient<Database>,
): Promise<OwnedProduct[]> {
  const catalogProductIds = Array.from(new Set(
    ownedProducts.flatMap((ownedProduct) =>
      ownedProduct.product.catalog_product_id
        ? [ownedProduct.product.catalog_product_id]
        : [],
    ),
  ));

  if (catalogProductIds.length === 0) return ownedProducts;

  const { data, error } = await adminSupabase
    .from("catalog_products")
    .select("id,catalog_image_url")
    .in("id", catalogProductIds);

  if (error) {
    throw new Error("CATALOG_PRODUCT_IMAGE_READ_FAILED", { cause: error });
  }

  return mergeCatalogImages(ownedProducts, data);
}

export function mergeCatalogImages(
  ownedProducts: OwnedProduct[],
  catalogImages: CatalogImageRow[],
): OwnedProduct[] {
  const imageByCatalogProductId = new Map(
    catalogImages.map((catalogProduct) => [
      catalogProduct.id,
      catalogProduct.catalog_image_url,
    ]),
  );

  return ownedProducts.map((ownedProduct) => {
    const catalogProductId = ownedProduct.product.catalog_product_id;
    if (!catalogProductId || !imageByCatalogProductId.has(catalogProductId)) {
      return ownedProduct;
    }

    return {
      ...ownedProduct,
      product: {
        ...ownedProduct.product,
        catalog_image_url: imageByCatalogProductId.get(catalogProductId) ?? null,
      },
    };
  });
}
