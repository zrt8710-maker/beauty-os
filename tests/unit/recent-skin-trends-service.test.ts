import { describe, expect, it, vi } from "vitest";

import type { DailyStateConcernKind, SkinCheckin } from "@/schemas/checkin";
import type { SkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { buildRecentSkinTrends, createRecentSkinTrendsService } from "@/server/services/recent-skin-trends-service";

describe("RecentSkinTrendsService", () => {
  it("returns a human-friendly eligible trend with repeated area and trigger", async () => {
    const repository = repo(
      Array.from({ length: 7 }, (_, index) =>
        checkin(
          `2026-08-${String(28 - index).padStart(2, "0")}`,
          "stinging",
          "cheeks",
          "洗脸后",
        ),
      ),
    );
    const trends = await createRecentSkinTrendsService(repository).listForUser("user-a", "2026-08-28");
    expect(trends).toEqual([
      {
        title: "脸颊刺痛近期反复出现",
        supporting_line: "过去28天的7次皮肤记录中，有7次记录到脸颊刺痛。",
        detail: "其中多次记录为：洗脸后",
      },
    ]);
  });

  it("does not display limited evidence or imply stability when there are no records", async () => {
    await expect(
      createRecentSkinTrendsService(
        repo([checkin("2026-08-28", "blackheads", "nose")]),
      ).listForUser("user-a", "2026-08-28"),
    ).resolves.toEqual([]);
    await expect(
      createRecentSkinTrendsService(repo([])).listForUser("user-a", "2026-08-28"),
    ).resolves.toEqual([]);
  });

  it("does not expose internal evidence metadata or update Profile", async () => {
    const repository = repo(
      Array.from({ length: 7 }, (_, index) =>
        checkin(
          `2026-08-${String(28 - index).padStart(2, "0")}`,
          "redness",
          "cheeks",
        ),
      ),
    );
    const trends = await createRecentSkinTrendsService(repository).listForUser("user-a", "2026-08-28");
    expect(JSON.stringify(trends)).not.toMatch(/unknown_days|evidence_strength|statements_allowed|confidence|redness/);
    expect(repository.upsertByDate).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("reuses already loaded check-ins without another repository query", () => {
    const records = Array.from({ length: 7 }, (_, index) =>
      checkin(
        `2026-08-${String(28 - index).padStart(2, "0")}`,
        "dryness",
        "cheeks",
      ),
    );

    expect(buildRecentSkinTrends(records, "2026-08-28")).toEqual([
      expect.objectContaining({ title: "脸颊干燥近期反复出现" }),
    ]);
  });
});

function repo(rows: SkinCheckin[]): SkinCheckinRepository {
  return {
    listByUserId: vi.fn().mockResolvedValue(rows),
    findById: vi.fn(),
    findByDate: vi.fn(),
    upsertByDate: vi.fn(),
    update: vi.fn(),
  } as unknown as SkinCheckinRepository;
}

function checkin(
  recorded_date: string,
  kind: DailyStateConcernKind,
  area: "cheeks" | "nose",
  trigger?: string,
): SkinCheckin {
  return {
    id: `50000000-0000-4000-8000-${recorded_date.replaceAll("-", "").padStart(12, "0")}`,
    dryness_level: 0,
    oiliness_level: 0,
    redness_level: 0,
    sensitivity_level: 0,
    acne_level: 0,
    notes: null,
    recorded_date,
    known_fields: [],
    field_provenance: {},
    created_at: "2026-08-01T00:00:00.000Z",
    is_legacy: false,
    daily_state: {
      version: 2,
      summary: kind,
      concerns: [
        {
          kind,
          status: "present",
          areas: [area],
          attributes: { severity: "slight", ...(trigger ? { trigger } : {}) },
          user_wording: [kind],
          source: ["conversation"],
          interaction_origin: "user_raised",
          area_origin: "user_confirmed",
        },
      ],
    },
  };
}
