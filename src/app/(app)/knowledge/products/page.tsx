import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createKnowledgeService } from "@/server/services/knowledge-service";

export default async function KnowledgeProductsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const service = createKnowledgeService(createKnowledgeRepository(await createClient()));
  const products = await service.listProducts({});

  return <main className="mx-auto max-w-4xl px-6 py-10">
    <div className="mb-8"><p className="text-sm font-medium text-muted-foreground">Product Knowledge</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">产品知识库</h1><p className="mt-3 max-w-2xl leading-7 text-muted-foreground">仅展示已验证的产品知识、来源与成分资料；它不等同于你的个人资产。</p></div>
    {products.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">尚无已验证的产品知识。</p> : <div className="space-y-4">{await Promise.all(products.map(async (product) => {
      const detail = await service.getProductIngredients(product.id);
      return <section className="rounded-2xl border bg-card p-5 shadow-sm" key={product.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{product.brand_name} · {product.product_name}{product.variant_name ? ` · ${product.variant_name}` : ""}</h2><p className="mt-1 text-sm text-muted-foreground">{product.category} / {product.product_type} · 置信度 {product.confidence}</p></div><p className="text-xs text-muted-foreground">来源：{product.source.name}</p></div><p className="mt-4 text-sm text-muted-foreground">成分：{detail.ingredients.length ? detail.ingredients.map((item) => item.ingredient.inci_name).join("、") : "暂无已验证成分资料"}</p></section>;
    }))}</div>}
  </main>;
}
