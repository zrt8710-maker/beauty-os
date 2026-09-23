import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { createRuleEngineService } from "@/server/services/rule-engine-service";
import { createProductDecisionResolverService } from "@/server/services/product-decision-resolver-service";
import { createProductKnowledgeRuntimeAvailabilityService } from "@/server/services/product-knowledge-runtime-availability-service";
import { createPlannerProductEvidenceService } from "@/server/services/planner-product-evidence-service";
import { createUsageService } from "@/server/services/usage-service";
import { createCarePlannerService } from "@/server/services/today-care-planner-service";
import { createConfiguredTodayCarePlannerProvider } from "@/server/services/volcengine-today-care-planner-provider";
import { createTodayUserNarrativeService } from "@/server/services/today-user-narrative-service";
import { createConfiguredTodayUserNarrativeProvider } from "@/server/services/volcengine-today-user-narrative-provider";
import { createIngredientKnowledgePack } from "@/server/services/ingredient-knowledge-pack";
import { createConfiguredPersonalMemoryService } from "@/server/services/personal-memory-service";
import { createTodayProductKnowledgeReadService } from "@/server/services/today-product-knowledge-read-service";

export async function getRoutineRequestContext() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const routines = createRoutineRepository(supabase);
  // Raw research drafts are internal data and remain inaccessible to the
  // authenticated browser client. These services only expose their sanitized
  // runtime projections while handling products already resolved from the
  // current user's owned-product set in the rule engine.
  const adminSupabase = createAdminClient();
  const serverDrafts = createProductResearchDraftRepository(adminSupabase);
  const formalKnowledge = createProductKnowledgeRepository(supabase);
  const knowledge = createKnowledgeRepository(supabase);
  const ingredientKnowledgePack = createIngredientKnowledgePack();
  const runtimeKnowledge = createProductKnowledgeRuntimeAvailabilityService({
    formal: formalKnowledge,
    drafts: serverDrafts,
  });
  return {
    user,
    service: createRuleEngineService({
      profiles: createProfileRepository(supabase),
      checkins: createSkinCheckinRepository(supabase),
      weather: createWeatherRepository(supabase),
      knowledge,
      productDecisions: createProductDecisionResolverService(runtimeKnowledge),
      runtimeDraftIngredients: runtimeKnowledge,
      plannerEvidence: createPlannerProductEvidenceService({
        drafts: serverDrafts,
        formal: formalKnowledge,
        ingredientKnowledgePack,
      }),
      todayProductKnowledge: createTodayProductKnowledgeReadService({
        formal: { findByCatalogProductIds: formalKnowledge.findByCatalogProductIds! },
        drafts: { getLatestUsableDrafts: serverDrafts.getLatestUsableDrafts! },
        ingredients: { listVerifiedProductIngredientsByProductIds: knowledge.listVerifiedProductIngredientsByProductIds! },
        ingredientKnowledgePack,
      }),
      carePlanner: createCarePlannerService(createConfiguredTodayCarePlannerProvider()),
      careNarrative: createTodayUserNarrativeService(createConfiguredTodayUserNarrativeProvider()),
      personalMemory: createConfiguredPersonalMemoryService({ supabase, userId: user.id }),
      ownedProducts: createOwnedProductRepository(supabase),
      routines,
      usage: createUsageService(createUsageRepository(supabase), routines),
    }),
  };
}
