import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type {
  ProductCategory,
  ProductSubcategory,
  ProductType,
} from "@/schemas/product";

export type CatalogIdentityProduct = {
  id: string;
  brand_name: string;
  product_name: string;
  variant_name: string | null;
  barcode: string | null;
  category: ProductCategory | null;
  subcategory: ProductSubcategory | null;
  product_type: ProductType | null;
  confidence: number;
  catalog_image_url?: string | null;
  catalog_image_source_url?: string | null;
  status: "candidate" | "verified";
  created_at: string;
  updated_at: string;
};

export type CatalogIdentityListQuery = {
  search?: string;
  limit: number;
};

export type CatalogIdentityRecallReason =
  | "normalized_name_exact"
  | "known_alias_exact"
  | "canonical_name_exact";

export type CatalogIdentityRecallResult = {
  exact: CatalogIdentityProduct[];
  plausible: CatalogIdentityProduct[];
  exact_reason: CatalogIdentityRecallReason | null;
};

export type ExternalIdentityReconciliationInput = {
  original_brand_name: string | null;
  original_product_name: string | null;
  external_brand_name: string | null;
  external_product_name: string;
  external_variant_name: string | null;
  external_aliases: string[];
  external_product_type: ProductType | null;
};

export type CatalogIdentityRepository = {
  findById(id: string): Promise<CatalogIdentityProduct | null>;
  findByBarcode(barcode: string): Promise<CatalogIdentityProduct | null>;
  findByIdentity(
    brandName: string,
    productName: string,
  ): Promise<CatalogIdentityProduct[]>;
  recallByIdentity?(
    brandName: string,
    productName: string,
  ): Promise<CatalogIdentityRecallResult>;
  reconcileExternalIdentity?(
    input: ExternalIdentityReconciliationInput,
  ): Promise<CatalogIdentityProduct[]>;
  listIdentityProducts(
    query: CatalogIdentityListQuery,
  ): Promise<CatalogIdentityProduct[]>;
};

const selection = "*" as const;

const identityStatuses = ["candidate", "verified"] as const;

/**
 * Identity-only Catalog boundary. Candidate rows are user-confirmed identities,
 * while verified-only knowledge and runtime repositories remain separate.
 */
export function createCatalogIdentityRepository(
  supabase: SupabaseClient<Database>,
): CatalogIdentityRepository {
  return {
    async findById(id) {
      const { data, error } = await supabase
        .from("catalog_products")
        .select(selection)
        .eq("id", id)
        .in("status", [...identityStatuses])
        .maybeSingle();
      if (error) throw readError(error);
      return data ? parseIdentityRow(data) : null;
    },

    async findByBarcode(barcode) {
      const { data, error } = await supabase
        .from("catalog_products")
        .select(selection)
        .eq("barcode", barcode)
        .in("status", [...identityStatuses])
        .limit(1)
        .maybeSingle();
      if (error) throw readError(error);
      return data ? parseIdentityRow(data) : null;
    },

    async findByIdentity(brandName, productName) {
      return (await recallProductsByIdentity(supabase, brandName, productName)).exact;
    },

    async recallByIdentity(brandName, productName) {
      return recallProductsByIdentity(supabase, brandName, productName);
    },

    async reconcileExternalIdentity(input) {
      return reconcileExternalIdentity(supabase, input);
    },

    listIdentityProducts(query) {
      return listProducts(supabase, query);
    },
  };
}

async function reconcileExternalIdentity(
  supabase: SupabaseClient<Database>,
  input: ExternalIdentityReconciliationInput,
) {
  const brandTerms = [...new Set([
    input.original_brand_name,
    input.external_brand_name,
    ...brandSegments(input.external_brand_name),
  ].filter((value): value is string => typeof value === "string" && normalizeIdentityText(value).length >= 2))];
  const resultSets = await Promise.all(brandTerms.map((search) => listProducts(supabase, { search, limit: 50 })));
  const rows = Array.from(new Map(resultSets.flat().map((row) => [row.id, row])).values());
  const aliases = await latestUsableIdentityAliases(supabase, rows.map((row) => row.id));
  const originalForms = input.original_product_name
    ? productEvidenceForms(input.original_brand_name, input.original_product_name, null)
    : [];
  const externalForms = [input.external_product_name, ...input.external_aliases]
    .flatMap((name) => productEvidenceForms(input.external_brand_name, name, input.external_variant_name));

  return rows.filter((row) => {
    const brandMatchesOriginal = brandCompatible(row.brand_name, input.original_brand_name);
    const brandMatchesExternal = brandCompatible(row.brand_name, input.external_brand_name);
    if (!brandMatchesOriginal && !brandMatchesExternal) return false;
    if (row.product_type && input.external_product_type && row.product_type !== input.external_product_type) return false;

    const existingForms = [row.product_name, ...(aliases.get(row.id) ?? [])]
      .flatMap((name) => productEvidenceForms(row.brand_name, name, row.variant_name));
    const externalDirect = externalForms.some((external) =>
      existingForms.some((existing) => external === existing || isConservativePlausibleMatch(external, existing))
    );
    if (externalDirect) return true;

    const originalToExisting = originalForms.some((original) =>
      existingForms.some((existing) => isCorroboratingNameEvidence(original, existing))
    );
    const externalToOriginal = externalForms.some((external) =>
      originalForms.some((original) => isCorroboratingNameEvidence(external, original))
    );
    return originalToExisting && externalToOriginal;
  });
}

function brandSegments(value: string | null) {
  if (!value) return [];
  return value
    .normalize("NFKC")
    .split(/[()（）\[\]【】:：/|]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function brandCompatible(left: string, right: string | null) {
  if (!right) return false;
  const normalizedLeft = normalizeIdentityText(left);
  const normalizedRight = normalizeIdentityText(right);
  if (normalizedLeft === normalizedRight) return true;
  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length > normalizedRight.length ? normalizedLeft : normalizedRight;
  return shorter.length >= 2 && longer.includes(shorter) && shorter.length / longer.length >= 0.35;
}

function productEvidenceForms(
  brandName: string | null,
  productName: string,
  variantName: string | null,
) {
  const base = matchingProductForm(brandName ?? "", productName, variantName);
  const withoutCrossScriptPrefix = base.replace(/^[a-z0-9]+(?=\p{Script=Han})/u, "");
  return [...new Set([base, withoutCrossScriptPrefix].filter((value) => value.length >= 2))];
}

function isCorroboratingNameEvidence(left: string, right: string) {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.55) return true;
  return sharedPrefixLength(left, right) >= 2
    && longestCommonSubsequenceLength(left, right) / shorter.length >= 0.7
    && bigramDice(left, right) >= 0.4;
}

async function recallProductsByIdentity(
  supabase: SupabaseClient<Database>,
  brandName: string,
  productName: string,
): Promise<CatalogIdentityRecallResult> {
      const rows = await listProducts(supabase, {
        search: brandName,
        limit: 50,
      });
      const normalizedBrand = normalizeIdentityText(brandName);
      const normalizedProduct = normalizeIdentityText(productName);
      const sameBrand = rows.filter((row) => normalizeIdentityText(row.brand_name) === normalizedBrand);
      const exactName = sameBrand.filter((row) => normalizeIdentityText(row.product_name) === normalizedProduct);
      if (exactName.length > 0) return { exact: exactName, plausible: [], exact_reason: "normalized_name_exact" };

      const aliases = await latestUsableIdentityAliases(supabase, sameBrand.map((row) => row.id));
      const aliasExact = sameBrand.filter((row) =>
        (aliases.get(row.id) ?? []).some((alias) => normalizeIdentityText(alias) === normalizedProduct)
      );
      if (aliasExact.length > 0) return { exact: aliasExact, plausible: [], exact_reason: "known_alias_exact" };

      const queryForm = matchingProductForm(brandName, productName, null);
      const canonicalExact = sameBrand.filter((row) =>
        matchingProductForm(row.brand_name, row.product_name, row.variant_name) === queryForm
        || (aliases.get(row.id) ?? []).some((alias) =>
          matchingProductForm(row.brand_name, alias, row.variant_name) === queryForm
        )
      );
      if (canonicalExact.length > 0) return { exact: canonicalExact, plausible: [], exact_reason: "canonical_name_exact" };

      const plausible = sameBrand.filter((row) => {
        const forms = [
          matchingProductForm(row.brand_name, row.product_name, row.variant_name),
          ...(aliases.get(row.id) ?? []).map((alias) => matchingProductForm(row.brand_name, alias, row.variant_name)),
        ];
        return forms.some((form) => isConservativePlausibleMatch(queryForm, form));
      });
      return { exact: [], plausible, exact_reason: null };
}

async function latestUsableIdentityAliases(
  supabase: SupabaseClient<Database>,
  catalogProductIds: string[],
) {
  const aliases = new Map<string, string[]>();
  if (catalogProductIds.length === 0) return aliases;
  const { data, error } = await supabase
    .from("catalog_product_research_drafts")
    .select("catalog_product_id,research_version,research_payload")
    .in("catalog_product_id", catalogProductIds)
    .in("status", ["draft", "review_pending", "approved"])
    .order("research_version", { ascending: false });
  if (error) throw readError(error);
  for (const draft of data ?? []) {
    if (aliases.has(draft.catalog_product_id)) continue;
    aliases.set(draft.catalog_product_id, identityAliases(draft.research_payload));
  }
  return aliases;
}

function identityAliases(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const identity = (payload as Record<string, unknown>).identity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return [];
  const aliases = (identity as Record<string, unknown>).aliases;
  return Array.isArray(aliases)
    ? aliases.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

export function matchingProductForm(
  brandName: string,
  productName: string,
  variantName: string | null,
) {
  const brand = normalizeIdentityText(brandName);
  const variant = variantName ? normalizeIdentityText(variantName) : "";
  let product = normalizeIdentityText(productName);
  if (brand && product.startsWith(brand) && product.length > brand.length) {
    product = product.slice(brand.length);
  }
  if (variant && product.endsWith(variant) && product.length > variant.length) {
    product = product.slice(0, -variant.length);
  }
  return product;
}

function isConservativePlausibleMatch(left: string, right: string) {
  if (left === right || left.length < 4 || right.length < 4) return false;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.55) return true;
  const commonPrefix = sharedPrefixLength(left, right);
  if (commonPrefix < 2) return false;
  const lcsRatio = longestCommonSubsequenceLength(left, right) / shorter.length;
  return lcsRatio >= 0.75 && bigramDice(left, right) >= 0.4;
}

function sharedPrefixLength(left: string, right: string) {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

function longestCommonSubsequenceLength(left: string, right: string) {
  const previous = new Array(right.length + 1).fill(0) as number[];
  for (const leftCharacter of left) {
    const current = [0];
    for (let index = 1; index <= right.length; index += 1) {
      current[index] = leftCharacter === right[index - 1]
        ? previous[index - 1]! + 1
        : Math.max(previous[index]!, current[index - 1]!);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

function bigramDice(left: string, right: string) {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let overlap = 0;
  const remaining = [...rightBigrams];
  for (const item of leftBigrams) {
    const index = remaining.indexOf(item);
    if (index >= 0) {
      overlap += 1;
      remaining.splice(index, 1);
    }
  }
  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function bigrams(value: string) {
  return Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2));
}

async function listProducts(
  supabase: SupabaseClient<Database>,
  query: CatalogIdentityListQuery,
) {
  let request = supabase
    .from("catalog_products")
    .select(selection)
    .in("status", [...identityStatuses])
    .order("updated_at", { ascending: false })
    .limit(query.limit);
  if (query.search?.trim()) {
    const search = escapePostgrestSearch(query.search.trim());
    request = request.or(
      `brand_name.ilike.%${search}%,product_name.ilike.%${search}%`,
    );
  }
  const { data, error } = await request;
  if (error) throw readError(error);
  return (data ?? []).map(parseIdentityRow);
}

function parseIdentityRow(row: unknown): CatalogIdentityProduct {
  return row as CatalogIdentityProduct;
}

function normalizeIdentityText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function escapePostgrestSearch(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}\s]+/gu, " ").trim();
}

function readError(cause: unknown) {
  return new Error("CATALOG_IDENTITY_READ_FAILED", { cause });
}
