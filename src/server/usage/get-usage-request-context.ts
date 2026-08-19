import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { createUsageService } from "@/server/services/usage-service";

export async function getUsageRequestContext() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  return {
    user,
    service: createUsageService(
      createUsageRepository(supabase),
      createRoutineRepository(supabase),
    ),
  };
}

