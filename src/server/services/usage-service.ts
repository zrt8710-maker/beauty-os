import "server-only";

import { z } from "zod";

import {
  usageHistoryIdSchema,
  usageHistoryListQuerySchema,
  usageHistorySchema,
  usageRecordInputSchema,
  type UsageHistory,
  type UsageHistoryListQuery,
} from "@/schemas/usage";
import type { RoutineRepository, RoutineWithStepsRow } from "@/server/repositories/routine-repository";
import type {
  ProductUsageStats,
  UsageHistoryWithProductsRow,
  UsageRepository,
} from "@/server/repositories/usage-repository";
import type { UsageFeedbackMessageInput } from "@/server/services/usage-feedback-conversation-service";
import type { RoutineRolePreference } from "@/schemas/usage";

export class UsageRoutineNotFoundError extends Error {
  constructor() {
    super("USAGE_ROUTINE_NOT_FOUND");
    this.name = "UsageRoutineNotFoundError";
  }
}

const databaseIsoTimestampSchema = z.iso.datetime({ offset: true });

/**
 * PostgREST may serialize timestamptz with an explicit UTC offset (`+00:00`).
 * The public UsageHistory DTO is deliberately canonical and accepts UTC `Z`.
 */
function normalizeUsageTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !databaseIsoTimestampSchema.safeParse(value).success) {
    throw new TypeError(`${field} must be an ISO datetime.`);
  }

  return new Date(value).toISOString();
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
    routine_role_preferences: row.routine_role_preferences,
    created_at: normalizeUsageTimestamp(row.created_at, "usage_history.created_at"),
    products: row.products.map((product) => ({
      id: product.id,
      usage_history_id: product.usage_history_id,
      owned_product_id: product.owned_product_id,
      rating: product.rating,
      reaction_level: product.reaction_level,
      reaction_tags: product.reaction_tags,
      texture_feedback: product.texture_feedback,
      notes: product.notes,
      created_at: normalizeUsageTimestamp(
        product.created_at,
        "usage_history_products.created_at",
      ),
    })),
  });
}

export type UsageService = {
  recordRoutineUsage(userId: string, routineId: unknown, input: unknown): Promise<UsageHistory>;
  recordFeedbackMessage(userId: string, routineId: unknown, input: UsageFeedbackMessageInput, existingRoutine?: RoutineWithStepsRow): Promise<{ history: UsageHistory; applied: boolean }>;
  listUsageHistory(userId: string, query: unknown): Promise<UsageHistory[]>;
  getRecentProductStats(
    userId: string,
    ownedProductIds: string[],
    today: string,
    period?: "am" | "pm",
  ): Promise<Map<string, ProductUsageStats>>;
  getRoutineRolePreferences(userId: string, period: "am" | "pm"): Promise<RoutineRolePreference[]>;
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

    async recordFeedbackMessage(userId, routineId, input, existingRoutine) {
      const id = usageHistoryIdSchema.parse(routineId);
      const routine = existingRoutine?.id === id ? existingRoutine : await routines.findById(userId, id);
      if (!routine) throw new UsageRoutineNotFoundError();
      const result = await usage.recordFeedbackMessage({ userId, routineId: id, feedback: input });
      return { history: toUsageHistory(result.history), applied: result.applied };
    },

    async listUsageHistory(userId, query) {
      const validated: UsageHistoryListQuery = usageHistoryListQuerySchema.parse(query);
      return (await usage.listByUserId(userId, validated.limit)).map(toUsageHistory);
    },

    async getRecentProductStats(userId, ownedProductIds, today, period) {
      return usage.getRecentProductStats(userId, ownedProductIds, dateDaysAgo(today, 29), period);
    },

    async getRoutineRolePreferences(userId, period) {
      return usage.getRoutineRolePreferences(userId, period);
    },
  };
}

function dateDaysAgo(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
