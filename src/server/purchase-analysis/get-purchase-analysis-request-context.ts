import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createPurchaseAnalysisRepository } from "@/server/repositories/purchase-analysis-repository";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { createPurchaseAnalysisService } from "@/server/services/purchase-analysis-service";
import { createUsageService } from "@/server/services/usage-service";

export async function getPurchaseAnalysisRequestContext() {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const routines = createRoutineRepository(supabase);
  return { user, service: createPurchaseAnalysisService({ analyses: createPurchaseAnalysisRepository(supabase), profiles: createProfileRepository(supabase), ownedProducts: createOwnedProductRepository(supabase), knowledge: createKnowledgeRepository(supabase), usage: createUsageService(createUsageRepository(supabase), routines) }) };
}
