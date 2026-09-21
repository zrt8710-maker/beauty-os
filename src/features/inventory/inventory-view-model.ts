import {
  PRODUCT_TYPE_META,
  type OwnedProduct,
  type Product,
  type ProductCategory,
  type ProductType,
  type UserAssetCategory,
} from "@/schemas/product";
import type { UploadAsset } from "@/schemas/upload";

export const ASSET_SECTIONS = [
  "skincare",
  "makeup",
  "cleansing",
  "other",
] as const;

export type AssetSection = (typeof ASSET_SECTIONS)[number];

export function suggestAssetCategory(
  product: Pick<Product, "category" | "product_type">,
): UserAssetCategory {
  return getLegacyAssetSection(product);
}

export const ASSET_SECTION_META: Record<
  AssetSection,
  { label: string; description: string }
> = {
  skincare: { label: "护肤", description: "精华、面霜、防晒等日常护理" },
  makeup: { label: "彩妆", description: "底妆、眼妆、唇妆等" },
  cleansing: { label: "清洁", description: "卸妆、洁面、洗护清洁" },
  other: { label: "其他", description: "身体护理、香氛、美妆工具等" },
};

const CLEANSING_PRODUCT_TYPES = new Set<ProductType>([
  "makeup_remover",
  "cleanser",
  "body_cleanser",
  "shampoo",
]);

export function getAssetSection(
  input:
    | Pick<OwnedProduct, "asset_category" | "product">
    | Pick<Product, "category" | "product_type">,
): AssetSection {
  if ("product" in input) {
    return input.asset_category ?? getLegacyAssetSection(input.product);
  }
  return getLegacyAssetSection(input);
}

function getLegacyAssetSection(
  product: Pick<Product, "category" | "product_type">,
): AssetSection {
  if (CLEANSING_PRODUCT_TYPES.has(product.product_type)) {
    return "cleansing";
  }

  if (product.category === "skincare") return "skincare";
  if (product.category === "makeup") return "makeup";
  return "other";
}

export function getAssetSectionCounts(inventory: OwnedProduct[]) {
  return inventory.reduce<Record<AssetSection, number>>(
    (counts, ownedProduct) => {
      counts[getAssetSection(ownedProduct)] += 1;
      return counts;
    },
    { skincare: 0, makeup: 0, cleansing: 0, other: 0 },
  );
}

export function filterInventoryBySection(
  inventory: OwnedProduct[],
  section: AssetSection,
) {
  return inventory.filter(
    (ownedProduct) => getAssetSection(ownedProduct) === section,
  );
}

export type InventoryBrandSection = {
  key: string;
  label: string;
  products: OwnedProduct[];
  isOtherBrands: boolean;
};

/**
 * Presentation-only grouping for a category view. Repeated named brands get a
 * section; singleton and unbranded products retain their source order together.
 */
export function groupInventoryByBrand(
  inventory: OwnedProduct[],
): InventoryBrandSection[] {
  const namedBrands = new Map<
    string,
    { label: string; products: OwnedProduct[] }
  >();

  for (const ownedProduct of inventory) {
    const label = ownedProduct.product.brand_name?.trim();
    if (!label) continue;

    const key = label.toLocaleLowerCase();
    const existing = namedBrands.get(key);
    if (existing) {
      existing.products.push(ownedProduct);
    } else {
      namedBrands.set(key, { label, products: [ownedProduct] });
    }
  }

  const repeatedBrandKeys = new Set(
    [...namedBrands.entries()]
      .filter(([, group]) => group.products.length >= 2)
      .map(([key]) => key),
  );
  const repeatedBrandSections = [...namedBrands.entries()]
    .filter(([key]) => repeatedBrandKeys.has(key))
    .map(([key, group]) => ({
      key: `brand:${key}`,
      label: group.label,
      products: group.products,
      isOtherBrands: false,
    }));
  const otherBrands = inventory.filter((ownedProduct) => {
    const label = ownedProduct.product.brand_name?.trim();
    return !label || !repeatedBrandKeys.has(label.toLocaleLowerCase());
  });

  return otherBrands.length > 0
    ? [
        ...repeatedBrandSections,
        {
          key: "other-brands",
          label: "其他品牌",
          products: otherBrands,
          isOtherBrands: true,
        },
      ]
    : repeatedBrandSections;
}

export function getProductTypesForAssetSection(section: AssetSection) {
  return (Object.entries(PRODUCT_TYPE_META) as Array<
    [ProductType, (typeof PRODUCT_TYPE_META)[ProductType]]
  >).filter(([productType, metadata]) =>
    getLegacyAssetSection({
      category: metadata.category,
      product_type: productType,
    }) === section,
  );
}

export function getStoredCategoryForProductType(productType: ProductType): ProductCategory {
  return PRODUCT_TYPE_META[productType].category;
}

export function groupInventoryBySection(inventory: OwnedProduct[]) {
  return Object.fromEntries(
    ASSET_SECTIONS.map((section) => [
      section,
      filterInventoryBySection(inventory, section),
    ]),
  ) as Record<AssetSection, OwnedProduct[]>;
}

export function getExpiryInformationHint(
  ownedProduct: Pick<OwnedProduct, "expires_on">,
) {
  return ownedProduct.expires_on
    ? null
    : "设置到期日期，更方便管理这件产品。";
}

export function getOwnedProductImageUploads(
  ownedProduct: Pick<OwnedProduct, "id" | "product_id">,
  uploads: UploadAsset[],
) {
  return uploads.filter((upload) =>
    upload.owned_product_id === ownedProduct.id
    || (upload.owned_product_id === null && upload.product_id === ownedProduct.product_id)
  );
}

export function preserveOwnedProductImagePresentation(
  current: OwnedProduct,
  saved: OwnedProduct,
): OwnedProduct {
  return {
    ...saved,
    product: {
      ...saved.product,
      catalog_image_url: saved.product.catalog_image_url ?? current.product.catalog_image_url,
    },
    image: current.image,
  };
}

export function synchronizeInventoryImagePresentation(
  currentInventory: OwnedProduct[],
  serverInventory: OwnedProduct[],
): OwnedProduct[] {
  const serverById = new Map(serverInventory.map((item) => [item.id, item]));

  return currentInventory.map((current) => {
    const server = serverById.get(current.id);
    if (!server) return current;

    return {
      ...current,
      identified_image_url: server.identified_image_url,
      identified_image_source_url: server.identified_image_source_url,
      image_override_upload_id: server.image_override_upload_id,
      product: {
        ...current.product,
        catalog_image_url: server.product.catalog_image_url,
      },
      image: server.image,
    };
  });
}
