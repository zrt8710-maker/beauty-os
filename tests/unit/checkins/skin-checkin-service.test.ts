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
  daily_state: null,
  notes: null,
  recorded_date: "2026-08-18",
  known_fields: null,
  field_provenance: null,
  created_at: "2026-08-18T08:00:00.000Z",
};

describe("SkinCheckinService", () => {
  it("保留已是 ISO datetime 的 created_at", async () => {
    const service = createSkinCheckinService(createRepository([row]));

    await expect(service.listCheckins("user-a", { limit: 7 })).resolves.toEqual([
      expect.objectContaining({ created_at: "2026-08-18T08:00:00.000Z" }),
    ]);
  });

  it("将迁移前记录作为 legacy unknown 返回，而不把零分视为已知无", async () => {
    const service = createSkinCheckinService(createRepository([row]));

    await expect(service.listCheckins("user-a", { limit: 7 })).resolves.toEqual([
      expect.objectContaining({ is_legacy: true, known_fields: [], field_provenance: {} }),
    ]);
  });

  it("loads a nullable rich state and safely ignores malformed historical JSON", async () => {
    const service = createSkinCheckinService(createRepository([
      { ...row, daily_state: null },
      { ...row, id: "50000000-0000-4000-8000-000000000002", daily_state: { version: 99 } as never },
    ]));
    await expect(service.listCheckins("user-a", { limit: 7 })).resolves.toEqual([
      expect.objectContaining({ daily_state: null }),
      expect.objectContaining({ daily_state: null }),
    ]);
  });

  it("将旧数据库 datetime 转换为 UTC ISO datetime", async () => {
    const service = createSkinCheckinService(
      createRepository([{ ...row, created_at: "2026-08-19 21:00:00" }]),
    );

    await expect(service.listCheckins("user-a", { limit: 7 })).resolves.toEqual([
      expect.objectContaining({ created_at: "2026-08-19T21:00:00.000Z" }),
    ]);
  });

  it.each([null, undefined])("拒绝空的 created_at：%s", async (createdAt) => {
    const service = createSkinCheckinService(
      createRepository([{ ...row, created_at: createdAt as never }]),
    );

    await expect(service.listCheckins("user-a", { limit: 7 })).rejects.toThrow(
      "skin_checkins.created_at must be a non-empty timestamp string.",
    );
  });

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
      known_fields: ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"],
      field_provenance: { dryness_level: ["manual"], oiliness_level: ["manual"], redness_level: ["manual"], sensitivity_level: ["manual"], acne_level: ["manual"] },
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

function createRepository(rows = [row]): SkinCheckinRepository {
  return {
    listByUserId: vi.fn().mockResolvedValue(rows),
    findById: vi.fn().mockResolvedValue(row),
    findByDate: vi.fn().mockResolvedValue(row),
    upsertByDate: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockResolvedValue(row),
  };
}
