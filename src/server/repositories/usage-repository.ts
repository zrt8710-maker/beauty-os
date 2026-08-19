import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/db/database.types";
import type { UsageRecordInput } from "@/schemas/usage";

export type UsageHistoryRow = Tables<"usage_history">;
export type UsageHistoryProductRow = Tables<"usage_history_products">;
export type UsageHistoryWithProductsRow = UsageHistoryRow & {
  products: UsageHistoryProductRow[];
};

export type ProductUsageStats = {
  usageCount: number;
  averageRating: number | null;
  highReactionCount: number;
};

export type UsageRepository = {
  findById(userId: string, usageHistoryId: string): Promise<UsageHistoryWithProductsRow | null>;
  listByUserId(userId: string, limit: number): Promise<UsageHistoryWithProductsRow[]>;
  record(input: {
    routineId: string;
    usedDate: string;
    period: "am" | "pm";
    usage: UsageRecordInput;
  }): Promise<UsageHistoryWithProductsRow>;
  getRecentProductStats(
    userId: string,
    ownedProductIds: string[],
    sinceDate: string,
  ): Promise<Map<string, ProductUsageStats>>;
};

const usageSelection = "*, products:usage_history_products(*)" as const;

export function createUsageRepository(
  supabase: SupabaseClient<Database>,
): UsageRepository {
  async function findById(userId: string, usageHistoryId: string) {
    const { data, error } = await supabase
      .from("usage_history")
      .select(usageSelection)
      .eq("id", usageHistoryId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error("USAGE_HISTORY_READ_FAILED", { cause: error });
    return data as UsageHistoryWithProductsRow | null;
  }

  return {
    findById,

    async listByUserId(userId, limit) {
      const { data, error } = await supabase
        .from("usage_history")
        .select(usageSelection)
        .eq("user_id", userId)
        .order("used_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error("USAGE_HISTORY_READ_FAILED", { cause: error });
      return data as UsageHistoryWithProductsRow[];
    },

    async record(input) {
      const { data, error } = await supabase.rpc("record_routine_usage", {
        p_routine_id: input.routineId,
        p_used_date: input.usedDate,
        p_period: input.period,
        p_completion_status: input.usage.completion_status,
        p_overall_rating: input.usage.overall_rating as never,
        p_skin_reaction_level: input.usage.skin_reaction_level as never,
        p_notes: input.usage.notes as never,
        p_products: input.usage.products as unknown as Json,
      });
      if (error || !data) throw new Error("USAGE_HISTORY_WRITE_FAILED", { cause: error });

      const { data: history, error: readError } = await supabase
        .from("usage_history")
        .select(usageSelection)
        .eq("id", data)
        .maybeSingle();
      if (readError || !history) {
        throw new Error("USAGE_HISTORY_READ_FAILED", { cause: readError });
      }
      return history as UsageHistoryWithProductsRow;
    },

    async getRecentProductStats(userId, ownedProductIds, sinceDate) {
      if (ownedProductIds.length === 0) return new Map();
      const { data, error } = await supabase
        .from("usage_history_products")
        .select("owned_product_id,rating,reaction_level,usage:usage_history!inner(user_id,used_date)")
        .in("owned_product_id", ownedProductIds)
        .eq("usage.user_id", userId)
        .gte("usage.used_date", sinceDate)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error("USAGE_HISTORY_STATS_READ_FAILED", { cause: error });

      const grouped = new Map<string, { ratings: number[]; usageCount: number; highReactionCount: number }>();
      for (const row of data) {
        const current = grouped.get(row.owned_product_id) ?? {
          ratings: [],
          usageCount: 0,
          highReactionCount: 0,
        };
        current.usageCount += 1;
        if (row.rating !== null) current.ratings.push(row.rating);
        if ((row.reaction_level ?? 0) >= 3) current.highReactionCount += 1;
        grouped.set(row.owned_product_id, current);
      }

      return new Map([...grouped].map(([ownedProductId, value]) => [
        ownedProductId,
        {
          usageCount: value.usageCount,
          averageRating: value.ratings.length
            ? value.ratings.reduce((sum, rating) => sum + rating, 0) / value.ratings.length
            : null,
          highReactionCount: value.highReactionCount,
        },
      ]));
    },
  };
}
