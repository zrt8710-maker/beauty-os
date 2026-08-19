import "server-only";

import {
  usageHistoryIdSchema,
  usageHistoryListQuerySchema,
  usageHistorySchema,
  usageRecordInputSchema,
  type UsageHistory,
  type UsageHistoryListQuery,
} from "@/schemas/usage";
import type { RoutineRepository } from "@/server/repositories/routine-repository";
import type {
  ProductUsageStats,
  UsageHistoryWithProductsRow,
  UsageRepository,
} from "@/server/repositories/usage-repository";

export class UsageRoutineNotFoundError extends Error {
  constructor() {
    super("USAGE_ROUTINE_NOT_FOUND");
    this.name = "UsageRoutineNotFoundError";
  }
}

function toUsageHistory(row: UsageHistoryWithProductsRow): UsageHistory {
  return usageHistorySchema.parse({
    id: row.id,
    routine_id: row.routine_id,
    used_date: row.used_date,
    period: row.period,
    completion_status: row.completion_status,
    overall_rating: row.overall_rating,
    skin_reaction_level: row.skin_reaction_level,
    notes: row.notes,
    created_at: row.created_at,
    products: row.products.map((product) => ({
      id: product.id,
      usage_history_id: product.usage_history_id,
      owned_product_id: product.owned_product_id,
      rating: product.rating,
      reaction_level: product.reaction_level,
      reaction_tags: product.reaction_tags,
      texture_feedback: product.texture_feedback,
      notes: product.notes,
      created_at: product.created_at,
    })),
  });
}

export type UsageService = {
  recordRoutineUsage(userId: string, routineId: unknown, input: unknown): Promise<UsageHistory>;
  listUsageHistory(userId: string, query: unknown): Promise<UsageHistory[]>;
  getRecentProductStats(
    userId: string,
    ownedProductIds: string[],
    today: string,
  ): Promise<Map<string, ProductUsageStats>>;
};

export function createUsageService(
  usage: UsageRepository,
  routines: RoutineRepository,
): UsageService {
  return {
    async recordRoutineUsage(userId, routineId, input) {
      const id = usageHistoryIdSchema.parse(routineId);
      const validated = usageRecordInputSchema.parse(input);
      const routine = await routines.findById(userId, id);
      if (!routine) throw new UsageRoutineNotFoundError();

      return toUsageHistory(await usage.record({
        routineId: id,
        usedDate: routine.routine_date,
        period: routine.period as "am" | "pm",
        usage: validated,
      }));
    },

    async listUsageHistory(userId, query) {
      const validated: UsageHistoryListQuery = usageHistoryListQuerySchema.parse(query);
      return (await usage.listByUserId(userId, validated.limit)).map(toUsageHistory);
    },

    async getRecentProductStats(userId, ownedProductIds, today) {
      return usage.getRecentProductStats(userId, ownedProductIds, dateDaysAgo(today, 29));
    },
  };
}

function dateDaysAgo(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
