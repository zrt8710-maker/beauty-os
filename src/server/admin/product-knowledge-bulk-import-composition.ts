import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { PRODUCT_TYPE_META } from "@/schemas/product";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createProductResearchDraftService } from "@/server/services/product-research-draft-service";

export function createAdminProductKnowledgeBulkImportDependencies() {
  const supabase = createAdminClient();
  const identities = createCatalogIdentityRepository(supabase);
  return {
    drafts: createProductResearchDraftService(createProductResearchDraftRepository(supabase)),
    images: {
      async update(catalogProductId: string, image: { catalog_image_url: string | null; catalog_image_source_url?: string | null }) {
        const { error } = await supabase.from("catalog_products").update({ catalog_image_url: image.catalog_image_url, catalog_image_source_url: null }).eq("id", catalogProductId);
        if (error) throw new Error("CATALOG_IMAGE_UPDATE_FAILED");
      },
    },
    catalog: {
      async findExact(identity: { brand_name: string; product_name: string; variant_name: string | null }) {
        const matches = await identities.findByIdentity(identity.brand_name, identity.product_name);
        return matches.filter((match) => sameNullableIdentity(match.variant_name, identity.variant_name));
      },
      async createBootstrap(input: {
        identity: { brand_name: string; product_name: string; variant_name: string | null };
        barcode: string | null;
        product_type: keyof typeof PRODUCT_TYPE_META;
        confidence: number;
        primary_source: { title: string; url: string | null; source_type: string; retrieved_at: string | null };
      }) {
        const { data: source, error: sourceError } = await supabase.from("knowledge_sources").insert({
          name: input.primary_source.title,
          source_type: input.primary_source.source_type,
          source_url: input.primary_source.url,
          retrieved_at: input.primary_source.retrieved_at ?? undefined,
        }).select("id").single();
        if (sourceError) throw new Error("CATALOG_BOOTSTRAP_SOURCE_CREATE_FAILED");
        const metadata = PRODUCT_TYPE_META[input.product_type];
        const { data: product, error: productError } = await supabase.from("catalog_products").insert({
          brand_name: input.identity.brand_name,
          product_name: input.identity.product_name,
          variant_name: input.identity.variant_name,
          barcode: input.barcode,
          category: metadata.category,
          subcategory: metadata.subcategory,
          product_type: input.product_type,
          confidence: input.confidence,
          primary_source_id: source.id,
          status: "candidate",
        }).select("id").single();
        if (productError) throw new Error("CATALOG_BOOTSTRAP_CREATE_FAILED");
        return product;
      },
    },
  };
}

function sameNullableIdentity(left: string | null, right: string | null) {
  return left === null ? right === null : right !== null && normalizeIdentity(left) === normalizeIdentity(right);
}

function normalizeIdentity(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]+/gu, "");
}
