import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ProductKnowledgeMaintenanceForm } from "@/features/admin/product-knowledge-maintenance-form";
import { ProductKnowledgeResearchButton } from "@/features/admin/product-knowledge-research-button";
import { CatalogProductImageMaintenance } from "@/features/admin/catalog-product-image-maintenance";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogProductIdSchema } from "@/schemas/knowledge";
import { requireAdminPageAccess } from "@/server/admin/require-admin-page-access";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createAdminProductKnowledgeOverviewService } from "@/server/services/admin-product-knowledge-overview-service";
import {
  PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS,
  PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_LABELS,
} from "@/server/services/product-knowledge-completeness-service";

export default async function ProductKnowledgeAdminDetailPage({
  params,
}: { params: Promise<{ catalogProductId: string }> }) {
  await requireAdminPageAccess();
  const { catalogProductId } = await params;
  const parsedId = catalogProductIdSchema.safeParse(catalogProductId);
  if (!parsedId.success) notFound();
  const supabase = createAdminClient();
  const item = await createAdminProductKnowledgeOverviewService({
    identities: createCatalogIdentityRepository(supabase),
    drafts: createProductResearchDraftRepository(supabase),
    ingredients: createKnowledgeRepository(supabase),
  }).get(parsedId.data);

  if (!item) notFound();
  const snapshot = item.latest_snapshot;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <Button nativeButton={false} render={<Link href="/admin/knowledge" />} variant="outline">
          返回 Product Knowledge
        </Button>
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Catalog 身份</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {item.product.brand_name} · {item.product.product_name}
        </h1>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="规格 / 版本" value={item.product.variant_name} />
          <Detail label="商品条码" value={item.product.barcode} />
          <Detail label="身份状态" value="身份已确认" />
          <Detail label="Today 知识状态" value={knowledgeStatusLabel(item.knowledge_status)} />
          <Detail label="整体可信度" value={displayConfidence(item.overall_confidence)} />
        </dl>
        <CatalogProductImageMaintenance
          catalogProductId={item.product.id}
          initialImageUrl={item.product.catalog_image_url ?? null}
        />
      </section>


      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Today 知识状态</p>
        <h2 className="mt-2 text-xl font-semibold">{knowledgeStatusLabel(item.knowledge_status)}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {knowledgeStatusDescription(item.knowledge_status)}
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">资料完整度</p>
        <h2 className="mt-2 text-xl font-semibold">
          {PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_LABELS[item.completeness.overall]}
        </h2>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="产品身份" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.identity]} />
          <Detail label="版本" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.variant]} />
          <Detail label="产品类型" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.product_type]} />
          <Detail label="成分" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.ingredients]} />
          <Detail label="公开宣称" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.claims]} />
          <Detail label="质地" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.texture]} />
          <Detail label="使用方法" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.usage]} />
          <Detail label="注意事项" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.cautions]} />
          <Detail label="不确定性 / 冲突" value={PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS[item.completeness.fields.uncertainties_conflicts]} />
        </dl>
      </section>

      {item.formalIngredientReadError ? (
        <section className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">技术状态</p>
          <p className="mt-2">正式成分关系暂时无法读取。研究草稿仍可正常查看，不影响本页其他资料。</p>
        </section>
      ) : null}

      <ProductKnowledgeMaintenanceForm catalogProductId={item.product.id} completeness={item.completeness} snapshot={snapshot} />
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-xl font-semibold">重新研究</h2>
        <p className="mt-2 text-sm text-muted-foreground">新研究会保留当前版本，并创建新的 AI 研究快照；不会修改 Catalog 身份或 User Asset。</p>
        <div className="mt-4"><ProductKnowledgeResearchButton catalogProductId={item.product.id} hasSnapshot={Boolean(snapshot)} /></div>
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value ?? "—"}</dd></div>;
}

function displayConfidence(value: number | null) {
  return value === null ? "—" : `${value}`;
}

function knowledgeStatusLabel(status: "not_researched" | "research_available" | "research_partial") {
  if (status === "research_available") return "Today 可用";
  if (status === "research_partial") return "Today 部分知识可用";
  return "知识待补充";
}

function knowledgeStatusDescription(status: "not_researched" | "research_available" | "research_partial") {
  if (status === "research_available") return "当前研究资料可供 Today 按字段读取。";
  if (status === "research_partial") return "Today 只读取当前已有的可靠字段；未知字段仍等待补充。";
  return "尚无可供 Today 读取的研究资料；补充研究后会自动可用。";
}
