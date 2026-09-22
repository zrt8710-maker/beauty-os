import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { getSupabaseAdminEnv } from "@/server/config/supabase-admin-env";
import { serverRealtime } from "@/lib/supabase/server-realtime";

export function createAdminClient() {
  const env = getSupabaseAdminEnv();

  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      realtime: serverRealtime,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
