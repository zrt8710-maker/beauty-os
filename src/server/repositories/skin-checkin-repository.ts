import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/db/database.types";
import type {
  SkinCheckinInput,
  SkinCheckinListQuery,
  SkinCheckinUpdateInput,
} from "@/schemas/checkin";

export type SkinCheckinRow = Tables<"skin_checkins">;

export type SkinCheckinRepository = {
  listByUserId(
    userId: string,
    query: SkinCheckinListQuery,
  ): Promise<SkinCheckinRow[]>;
  findById(userId: string, checkinId: string): Promise<SkinCheckinRow | null>;
  findByDate(userId: string, recordedDate: string): Promise<SkinCheckinRow | null>;
  upsertByDate(
    userId: string,
    input: SkinCheckinInput,
  ): Promise<SkinCheckinRow>;
  update(
    userId: string,
    checkinId: string,
    input: SkinCheckinUpdateInput,
  ): Promise<SkinCheckinRow | null>;
};

export function createSkinCheckinRepository(
  supabase: SupabaseClient<Database>,
): SkinCheckinRepository {
  return {
    async listByUserId(userId, query) {
      const { data, error } = await supabase
        .from("skin_checkins")
        .select("*")
        .eq("user_id", userId)
        .order("recorded_date", { ascending: false })
        .limit(query.limit);

      if (error) {
        throw new Error("SKIN_CHECKIN_READ_FAILED", { cause: error });
      }

      return data;
    },

    async findById(userId, checkinId) {
      const { data, error } = await supabase
        .from("skin_checkins")
        .select("*")
        .eq("id", checkinId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("SKIN_CHECKIN_READ_FAILED", { cause: error });
      }

      return data;
    },

    async findByDate(userId, recordedDate) {
      const { data, error } = await supabase
        .from("skin_checkins")
        .select("*")
        .eq("user_id", userId)
        .eq("recorded_date", recordedDate)
        .maybeSingle();

      if (error) throw new Error("SKIN_CHECKIN_READ_FAILED", { cause: error });
      return data;
    },

    async upsertByDate(userId, input) {
      const { data, error } = await supabase
        .from("skin_checkins")
        .upsert(
          { ...input, user_id: userId },
          { onConflict: "user_id,recorded_date" },
        )
        .select("*")
        .single();

      if (error || !data) {
        throw new Error("SKIN_CHECKIN_WRITE_FAILED", { cause: error });
      }

      return data;
    },

    async update(userId, checkinId, input) {
      const { data, error } = await supabase
        .from("skin_checkins")
        .update(input)
        .eq("id", checkinId)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error("SKIN_CHECKIN_WRITE_FAILED", { cause: error });
      }

      return data;
    },
  };
}
