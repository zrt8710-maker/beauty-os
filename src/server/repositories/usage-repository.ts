import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/db/database.types";
import { routineRolePreferenceSchema, type RoutineRolePreference, type UsageRecordInput } from "@/schemas/usage";
import type { UsageFeedbackMessageInput } from "@/server/services/usage-feedback-conversation-service";

export type UsageHistoryRow = Tables<"usage_history">;
export type UsageHistoryProductRow = Tables<"usage_history_products">;
export type UsageHistoryWithProductsRow = UsageHistoryRow & {
  products: UsageHistoryProductRow[];
};

export type ProductUsageStats = {
  usageCount: number;
  averageRating: number | null;
  highReactionCount: number;
  /** Product-level positive ratings inside the recent private history window. */
  positiveCount?: number;
  /** Compact, canonical preference signals only; never raw notes. */
  preferenceIssueTags?: string[];
  /** One private, Planner-facing summary; no raw notes or score values. */
  recentRelevantFeedbackSummary?: string | null;
};

export type ProductUsageStatsRow = {
  owned_product_id: string;
  rating: number | null;
  reaction_level: number | null;
  reaction_tags: string[];
  texture_feedback: string | null;
  usage: { period: string } | Array<{ period: string }>;
};

export type QuantityUsageRecord = {
  ownedProductId: string;
  usedDate: string;
};

type QuantityUsageRow = {
  owned_product_id: string;
  usage: { used_date: string } | Array<{ used_date: string }>;
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
  recordFeedbackMessage(input: {
    userId: string;
    routineId: string;
    feedback: UsageFeedbackMessageInput;
  }): Promise<{ history: UsageHistoryWithProductsRow; applied: boolean }>;
  getRecentProductStats(
    userId: string,
    ownedProductIds: string[],
    sinceDate: string,
    period?: "am" | "pm",
  ): Promise<Map<string, ProductUsageStats>>;
  listRecentQuantityUsage(
    userId: string,
    sinceDate: string,
  ): Promise<QuantityUsageRecord[]>;
  getRoutineRolePreferences(
    userId: string,
    period: "am" | "pm",
  ): Promise<RoutineRolePreference[]>;
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

    async recordFeedbackMessage(input) {
      const { data, error } = await supabase.rpc("record_usage_feedback_message", {
        p_routine_id: input.routineId,
        p_conversation_id: input.feedback.conversationId,
        p_message_id: input.feedback.messageId,
        p_completion_status: input.feedback.completionStatus,
        p_notes: input.feedback.notes,
        p_products: input.feedback.products as unknown as Json,
        p_routine_role_preferences: (input.feedback.routineRolePreferences ?? []) as unknown as Json,
      });
      const result = data?.[0];
      if (error || !result) throw new Error("USAGE_FEEDBACK_MESSAGE_WRITE_FAILED", { cause: error });
      const history = await findById(input.userId, result.usage_id);
      if (!history) throw new Error("USAGE_HISTORY_READ_FAILED");
      return { history, applied: result.applied };
    },

    async getRecentProductStats(userId, ownedProductIds, sinceDate, period) {
      if (ownedProductIds.length === 0) return new Map();
      const { data, error } = await supabase
        .from("usage_history_products")
        .select("owned_product_id,rating,reaction_level,reaction_tags,texture_feedback,usage:usage_history!inner(user_id,used_date,period)")
        .in("owned_product_id", ownedProductIds)
        .eq("usage.user_id", userId)
        .gte("usage.used_date", sinceDate)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error("USAGE_HISTORY_STATS_READ_FAILED", { cause: error });

      return aggregateRecentProductStats(data as ProductUsageStatsRow[], period);
    },

    async listRecentQuantityUsage(userId, sinceDate) {
      const { data, error } = await supabase
        .from("usage_history_products")
        .select("owned_product_id,usage:usage_history!inner(used_date)")
        .eq("usage.user_id", userId)
        .gte("usage.used_date", sinceDate)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error("QUANTITY_USAGE_READ_FAILED", { cause: error });

      return (data as QuantityUsageRow[]).flatMap((row) => {
        const usage = Array.isArray(row.usage) ? row.usage[0] : row.usage;
        return usage
          ? [{ ownedProductId: row.owned_product_id, usedDate: usage.used_date }]
          : [];
      });
    },

    async getRoutineRolePreferences(userId, period) {
      const { data, error } = await supabase
        .from("usage_history")
        .select("routine_role_preferences,used_date,created_at")
        .eq("user_id", userId)
        .order("used_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error("USAGE_ROUTINE_PREFERENCES_READ_FAILED", { cause: error });

      const latestByRole = new Map<string, RoutineRolePreference>();
      for (const row of data) {
        const parsed = routineRolePreferenceSchema.array().safeParse(row.routine_role_preferences);
        if (!parsed.success) continue;
        for (const preference of parsed.data) {
          if (preference.period === period && !latestByRole.has(preference.routine_role)) {
            latestByRole.set(preference.routine_role, preference);
          }
        }
      }
      return [...latestByRole.values()];
    },
  };
}

export function aggregateRecentProductStats(rows: ProductUsageStatsRow[], period?: "am" | "pm") {
  const grouped = new Map<string, { ratings: number[]; usageCount: number; positiveCount: number; highReactionCount: number; preferenceIssueCounts: Map<string, number> }>();
  for (const row of rows) {
    const usagePeriod = Array.isArray(row.usage) ? row.usage[0]?.period : row.usage.period;
    const appliesToRequestedPeriod = period === undefined || usagePeriod === period;
    const current = grouped.get(row.owned_product_id) ?? {
      ratings: [], usageCount: 0, positiveCount: 0, highReactionCount: 0,
      preferenceIssueCounts: new Map<string, number>(),
    };
    if (appliesToRequestedPeriod) current.usageCount += 1;
    if (appliesToRequestedPeriod && row.rating !== null) {
      current.ratings.push(row.rating);
      if (row.rating >= 4) current.positiveCount += 1;
    }
    if ((row.reaction_level ?? 0) >= 3) current.highReactionCount += 1;
    if (appliesToRequestedPeriod) {
      for (const tag of preferenceIssueTags(row.texture_feedback, row.reaction_tags)) {
        current.preferenceIssueCounts.set(tag, (current.preferenceIssueCounts.get(tag) ?? 0) + 1);
      }
    }
    grouped.set(row.owned_product_id, current);
  }
  return new Map([...grouped].map(([ownedProductId, value]) => [ownedProductId, {
    usageCount: value.usageCount,
    averageRating: value.ratings.length ? value.ratings.reduce((sum, rating) => sum + rating, 0) / value.ratings.length : null,
    positiveCount: value.positiveCount,
    preferenceIssueTags: [...value.preferenceIssueCounts.entries()]
      .filter(([, count]) => count >= 1)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([tag]) => tag),
    highReactionCount: value.highReactionCount,
    recentRelevantFeedbackSummary: personalFeedbackSummary(value),
  }]));
}

const PREFERENCE_ISSUE_TAGS = new Set(["too_oily", "too_sticky", "pilling", "not_hydrating_enough"]);

function preferenceIssueTags(textureFeedback: string | null, reactionTags: string[]) {
  return [...new Set([
    ...(textureFeedback?.split(",") ?? []),
    ...reactionTags,
  ].map((tag) => tag.trim()).filter((tag) => PREFERENCE_ISSUE_TAGS.has(tag)))];
}

function personalFeedbackSummary(value: { usageCount: number; positiveCount: number; highReactionCount: number; preferenceIssueCounts: Map<string, number> }) {
  const parts: string[] = [];
  if (value.positiveCount >= 2) parts.push("近几次体验较稳定");
  for (const [tag, count] of value.preferenceIssueCounts) {
    if (count >= 2) parts.push(preferenceIssueSummary(tag));
  }
  if (value.highReactionCount > 0) parts.push("曾记录明显不适");
  return parts.join("；") || null;
}

function preferenceIssueSummary(tag: string) {
  const labels: Record<string, string> = {
    too_oily: "多次反馈偏油",
    too_sticky: "多次反馈偏黏",
    pilling: "多次反馈搓泥",
    not_hydrating_enough: "多次反馈保湿不够",
  };
  return labels[tag] ?? "有重复肤感问题";
}
