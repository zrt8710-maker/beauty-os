import { redirect } from "next/navigation";

import { PurchaseAdvisor } from "@/features/purchase-advisor/purchase-advisor";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getPurchaseAnalysisRequestContext } from "@/server/purchase-analysis/get-purchase-analysis-request-context";

export default async function PurchaseAdvisorPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const context = await getPurchaseAnalysisRequestContext();
  if (!context) redirect("/login");
  const analyses = await context.service.list(user.id, { limit: 10 });
  return <main className="beauty-ambient-page beauty-ambient-purchase beauty-page"><div className="beauty-page-header"><h1 className="beauty-page-title">我真的需要买吗？</h1><p className="beauty-copy mt-3">先给出是否值得买的判断，再说明它与你现有资产、皮肤状态和使用习惯的关系。</p></div><PurchaseAdvisor initialAnalyses={analyses} /></main>;
}
