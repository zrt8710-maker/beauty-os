import { describe, expect, it, vi } from "vitest";

import type { SkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createSkinCheckinService } from "@/server/services/skin-checkin-service";

const row = {
  id: "50000000-0000-4000-8000-000000000001",
  user_id: "user-a",
  dryness_level: 1,
  oiliness_level: 2,
  redness_level: 0,
  sensitivity_level: 1,
  acne_level: 0,
  notes: null,
  recorded_date: "2026-08-18",
  created_at: "2026-08-18T08:00:00.000Z",
};

describe("SkinCheckinService", () => {
  it("同一天重复保存都走 user/date upsert 并返回同一记录", async () => {
    const repository = createRepository();
    const service = createSkinCheckinService(repository);
    const input = {
      dryness_level: 1,
      oiliness_level: 2,
      redness_level: 0,
      sensitivity_level: 1,
      acne_level: 0,
      notes: null,
      recorded_date: "2026-08-18",
    };

    const first = await service.createOrUpdateCheckin("user-a", input);
    const second = await service.createOrUpdateCheckin("user-a", {
      ...input,
      dryness_level: 3,
    });

    expect(repository.upsertByDate).toHaveBeenCalledTimes(2);
    expect(repository.upsertByDate).toHaveBeenLastCalledWith(
      "user-a",
      expect.objectContaining({ recorded_date: "2026-08-18", dryness_level: 3 }),
    );
    expect(first.id).toBe(second.id);
  });
});

function createRepository(): SkinCheckinRepository {
  return {
    listByUserId: vi.fn().mockResolvedValue([row]),
    findById: vi.fn().mockResolvedValue(row),
    findByDate: vi.fn().mockResolvedValue(row),
    upsertByDate: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockResolvedValue(row),
  };
}
