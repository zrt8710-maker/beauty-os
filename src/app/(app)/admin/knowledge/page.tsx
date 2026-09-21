import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminPageAccess } from "@/server/admin/require-admin-page-access";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createAdminProductKnowledgeOverviewService } from "@/server/services/admin-product-knowledge-overview-service";
import { PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_LABELS } from "@/server/services/product-knowledge-completeness-service";
import { ProductKnowledgeBulkImport } from "@/features/admin/product-knowledge-bulk-import";
import { CatalogProductThumbnail } from "@/features/admin/catalog-product-thumbnail";

export default async function KnowledgeAdminPage() {
  await requireAdminPageAccess();
  const supabase = createAdminClient();
  const products = await createAdminProductKnowledgeOverviewService({
    identities: createCatalogIdentityRepository(supabase),
    drafts: createProductResearchDraftRepository(supabase),
    ingredients: createKnowledgeRepository(supabase),
  }).list();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-sm font-medium text-muted-foreground">Knowledge Quality</p>
        <h1 className="mt-2 text-3xl font-semibold">Product Knowledge</h1>
        <p className="mt-2 text-muted-foreground">
          存在可用研究资料的产品可直接供 Today 使用；资料补全不需要额外发布步骤。
        </p>
      </header>

      <ProductKnowledgeBulkImport />

      {products.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed p-5 text-muted-foreground">
          暂无已确认的 Catalog 产品。
        </p>
      ) : (
        <section className="mt-6 space-y-3">
          {products.map((item) => (
            <Link
              className="block rounded-xl border bg-card p-5 hover:bg-muted/40"
              href={`/admin/knowledge/products/${item.product.id}`}
              key={item.product.id}
            >
              <div className="flex flex-wrap justify-between gap-3">
                <CatalogProductThumbnail imageUrl={item.product.catalog_image_url ?? null} productName={`${item.product.brand_name} ${item.product.product_name}`} />
                <div>
                  <h2 className="font-semibold">
                    {item.product.brand_name} · {item.product.product_name}
                    {item.product.variant_name ? ` · ${item.product.variant_name}` : ""}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Tag>身份已确认</Tag>
                    <Tag>{knowledgeStatusLabel(item.knowledge_status)}</Tag>
                    <Tag>{PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_LABELS[item.completeness.overall]}</Tag>
                  </div>
                </div>
                <time className="text-sm text-muted-foreground">
                  {new Date(item.updated_at).toLocaleString("zh-CN")}
                </time>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                资料完整度：{PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_LABELS[item.completeness.overall]} · 整体可信度：{item.overall_confidence ?? "—"}
              </p>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}

function knowledgeStatusLabel(status: "not_researched" | "research_available" | "research_partial") {
  if (status === "research_available") return "Today 可用";
  if (status === "research_partial") return "Today 部分知识可用";
  return "知识待补充";
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">{children}</span>;
}
