import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Tables,
  TablesUpdate,
} from "@/db/database.types";

export type ProfileRow = Tables<"profiles">;
export type ProfileUpdate = Omit<TablesUpdate<"profiles">, "user_id">;

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
        throw new Error("PROFILE_WRITE_FAILED", { cause: error });
      }

      return data;
    },
  };
}
