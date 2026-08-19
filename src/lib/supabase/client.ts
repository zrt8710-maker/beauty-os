import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/db/database.types";
import { getPublicEnv } from "@/env";

export function createClient() {
  const env = getPublicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
