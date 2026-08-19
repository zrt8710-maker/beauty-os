import { redirect } from "next/navigation";

import { PurchaseAdvisor } from "@/features/purchase-advisor/purchase-advisor";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getPurchaseAnalysisRequestContext } from "@/server/purchase-analysis/get-purchase-analysis-request-context";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createKnowledgeService } from "@/server/services/knowledge-service";

export default async function PurchaseAdvisorPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const context = await getPurchaseAnalysisRequestContext();
  if (!context) redirect("/login");
  const knowledge = createKnowledgeService(createKnowledgeRepository(await createClient()));
  const [catalogProducts, analyses] = await Promise.all([knowledge.listProducts({ limit: 50 }), context.service.list(user.id, { limit: 10 })]);
  return <main className="mx-auto max-w-5xl px-6 py-10"><div className="mb-8"><p className="text-sm font-medium text-muted-foreground">Purchase Advisor</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">我真的需要买吗？</h1><p className="mt-3 max-w-2xl leading-7 text-muted-foreground">只基于你的库存、皮肤档案、使用反馈和已验证知识进行规则判断，不包含 AI、价格或电商推荐。</p></div><PurchaseAdvisor catalogProducts={catalogProducts} initialAnalyses={analyses} /></main>;
}
