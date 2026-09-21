import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Tables,
  TablesUpdate,
} from "@/db/database.types";

export type ProfileRow = Tables<"profiles">;
export type ProfileUpdate = Omit<TablesUpdate<"profiles">, "user_id">;

type SupabaseFailure = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function logProfileUpdateFailure(error: SupabaseFailure | null) {
  const message = typeof error?.message === "string" ? error.message : "No row returned";
  const column = message.match(/['"]([a-z_]+)['"]\s+column/i)?.[1];

  // Keep write diagnostics structural: neither the authenticated user nor request
  // values are included in server logs.
  console.error("[profile-update]", {
    stage: "supabase_update",
    error_code: typeof error?.code === "string" ? error.code : undefined,
    error_message: message,
    database_table: "profiles",
    database_column: column,
    database_details: typeof error?.details === "string" ? error.details : undefined,
    database_hint: typeof error?.hint === "string" ? error.hint : undefined,
  });
}

export type ProfileRepository = {
  findByUserId(userId: string): Promise<ProfileRow | null>;
  upsertByUserId(
    userId: string,
    update: ProfileUpdate,
  ): Promise<ProfileRow>;
};

export function createProfileRepository(
  supabase: SupabaseClient<Database>,
): ProfileRepository {
  return {
    async findByUserId(userId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("PROFILE_READ_FAILED", { cause: error });
      }

      return data;
    },

    async upsertByUserId(userId, update) {
      const { data, error } = await supabase
        .from("profiles")
        .upsert(
          {
            ...update,
            user_id: userId,
          },
          { onConflict: "user_id" },
        )
        .select("*")
        .single();

      if (error || !data) {
        logProfileUpdateFailure(error);
        throw new Error("PROFILE_WRITE_FAILED", { cause: error });
      }

      return data;
    },
  };
}
