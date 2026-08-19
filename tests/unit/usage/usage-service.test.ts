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
    expect(usage.getRecentProductStats).toHaveBeenCalledWith(userId, expect.any(Array), "2026-07-20");
  });
});

function routineRepository(found: boolean): RoutineRepository {
  return { findByDate: vi.fn(), replace: vi.fn(), findById: vi.fn().mockResolvedValue(found ? { routine_date: "2026-08-18", period: "am" } : null) } as unknown as RoutineRepository;
}

function repository(): UsageRepository {
  return {
    findById: vi.fn(), listByUserId: vi.fn(), getRecentProductStats: vi.fn().mockResolvedValue(new Map()),
    record: vi.fn().mockResolvedValue({ id: "40000000-0000-4000-8000-000000000001", routine_id: routineId, used_date: "2026-08-18", period: "am", completion_status: "completed", overall_rating: null, skin_reaction_level: null, notes: null, created_at: "2026-08-18T00:00:00.000Z", products: [] }),
  };
}
