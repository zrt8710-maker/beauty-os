import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { createRuleEngineService } from "@/server/services/rule-engine-service";
import { createUsageService } from "@/server/services/usage-service";

export async function getRoutineRequestContext() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const routines = createRoutineRepository(supabase);
  return {
    user,
    service: createRuleEngineService({
      profiles: createProfileRepository(supabase),
      checkins: createSkinCheckinRepository(supabase),
      weather: createWeatherRepository(supabase),
      ownedProducts: createOwnedProductRepository(supabase),
      routines,
      usage: createUsageService(createUsageRepository(supabase), routines),
    }),
  };
}
