import { describe, expect, it, vi } from "vitest";

import type { RoutineRepository } from "@/server/repositories/routine-repository";
import type { UsageRepository } from "@/server/repositories/usage-repository";
import { UsageRoutineNotFoundError, createUsageService } from "@/server/services/usage-service";

const userId = "10000000-0000-4000-8000-000000000001";
const routineId = "20000000-0000-4000-8000-000000000001";

describe("UsageService", () => {
  it("完成方案时按方案日期和时段创建不可变历史", async () => {
    const usage = repository();
    const routines = routineRepository(true);
    const service = createUsageService(usage, routines);

    await service.recordRoutineUsage(userId, routineId, { completion_status: "completed", products: [] });

    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({
      routineId, usedDate: "2026-08-18", period: "am",
    }));
  });

  it("其他用户的方案无法写入反馈", async () => {
    const usage = repository();
    const service = createUsageService(usage, routineRepository(false));
    await expect(service.recordRoutineUsage(userId, routineId, { completion_status: "completed", products: [] }))
      .rejects.toBeInstanceOf(UsageRoutineNotFoundError);
    expect(usage.record).not.toHaveBeenCalled();
  });

  it("统计严格限定最近 30 天", async () => {
    const usage = repository();
    const service = createUsageService(usage, routineRepository(true));
    await service.getRecentProductStats(userId, ["30000000-0000-4000-8000-000000000001"], "2026-08-18");
    expect(usage.getRecentProductStats).toHaveBeenCalledWith(userId, expect.any(Array), "2026-07-20", undefined);
  });

  it("forwards the requested period for product feedback and routine-role preferences", async () => {
    const usage = repository();
    const service = createUsageService(usage, routineRepository(true));

    await service.getRecentProductStats(userId, ["30000000-0000-4000-8000-000000000001"], "2026-08-18", "am");
    await service.getRoutineRolePreferences(userId, "pm");

    expect(usage.getRecentProductStats).toHaveBeenLastCalledWith(userId, expect.any(Array), "2026-07-20", "am");
    expect(usage.getRoutineRolePreferences).toHaveBeenCalledWith(userId, "pm");
  });

  it("normalizes PostgREST offset timestamps before returning UsageHistory", async () => {
    const usage = repository();
    vi.mocked(usage.recordFeedbackMessage).mockResolvedValue({
      applied: true,
      history: {
        id: "40000000-0000-4000-8000-000000000001", routine_id: routineId,
        used_date: "2026-08-18", period: "am", completion_status: "completed",
        user_id: userId, feedback_conversation_id: "10000000-0000-4000-8000-000000000010",
        feedback_message_ids: ["10000000-0000-4000-8000-000000000011"],
        overall_rating: null, skin_reaction_level: null, notes: null,
        routine_role_preferences: [],
        created_at: "2026-09-11T14:26:06.715983+00:00",
        products: [{
          id: "50000000-0000-4000-8000-000000000001", usage_history_id: "40000000-0000-4000-8000-000000000001",
          owned_product_id: "30000000-0000-4000-8000-000000000001", rating: 4,
          reaction_level: null, reaction_tags: [], texture_feedback: "too_sticky", notes: null,
          created_at: "2026-09-11T14:26:06.715983+00:00",
        }],
      },
    });
    const service = createUsageService(usage, routineRepository(true));

    const result = await service.recordFeedbackMessage(userId, routineId, {
      conversationId: "10000000-0000-4000-8000-000000000010",
      messageId: "10000000-0000-4000-8000-000000000011",
      completionStatus: "completed", notes: null, products: [],
    });

    expect(result.history.created_at).toBe("2026-09-11T14:26:06.715Z");
    expect(result.history.products[0]?.created_at).toBe("2026-09-11T14:26:06.715Z");
  });

  it("reuses a routine already authorized by the request without a second read", async () => {
    const usage = repository();
    const routines = routineRepository(true);
    const service = createUsageService(usage, routines);
    vi.mocked(usage.recordFeedbackMessage).mockResolvedValue({
      applied: true,
      history: { id: "40000000-0000-4000-8000-000000000001", routine_id: routineId, used_date: "2026-08-18", period: "am", completion_status: "completed", user_id: userId, feedback_conversation_id: null, feedback_message_ids: [], overall_rating: null, skin_reaction_level: null, notes: null, routine_role_preferences: [], created_at: "2026-08-18T00:00:00.000Z", products: [] },
    });
    const existingRoutine = { id: routineId, routine_date: "2026-08-18", period: "am", steps: [] } as never;

    await service.recordFeedbackMessage(userId, routineId, { conversationId: "10000000-0000-4000-8000-000000000010", messageId: "10000000-0000-4000-8000-000000000011", completionStatus: "completed", notes: null, products: [] }, existingRoutine);

    expect(routines.findById).not.toHaveBeenCalled();
    expect(usage.recordFeedbackMessage).toHaveBeenCalledWith(expect.objectContaining({ userId, routineId }));
  });
});

function routineRepository(found: boolean): RoutineRepository {
  return { findByDate: vi.fn(), replace: vi.fn(), findById: vi.fn().mockResolvedValue(found ? { routine_date: "2026-08-18", period: "am" } : null) } as unknown as RoutineRepository;
}

function repository(): UsageRepository {
  return {
    findById: vi.fn(), listByUserId: vi.fn(), getRecentProductStats: vi.fn().mockResolvedValue(new Map()), listRecentQuantityUsage: vi.fn().mockResolvedValue([]), getRoutineRolePreferences: vi.fn().mockResolvedValue([]),
    recordFeedbackMessage: vi.fn(),
    record: vi.fn().mockResolvedValue({ id: "40000000-0000-4000-8000-000000000001", routine_id: routineId, used_date: "2026-08-18", period: "am", completion_status: "completed", overall_rating: null, skin_reaction_level: null, notes: null, routine_role_preferences: [], created_at: "2026-08-18T00:00:00.000Z", products: [] }),
  };
}
