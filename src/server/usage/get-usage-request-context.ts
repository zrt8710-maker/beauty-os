import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { createUsageService } from "@/server/services/usage-service";
import { createConfiguredPersonalMemoryService } from "@/server/services/personal-memory-service";

export async function getUsageRequestContext() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const routines = createRoutineRepository(supabase);
  return {
    user,
    routines,
    memory: createConfiguredPersonalMemoryService({ supabase, userId: user.id }),
    service: createUsageService(
      createUsageRepository(supabase),
      routines,
    ),
  };
}
