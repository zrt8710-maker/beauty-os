import { describe, expect, it } from "vitest";

import { createUsageRepository } from "@/server/repositories/usage-repository";

const userId = "10000000-0000-4000-8000-000000000001";

describe("UsageRepository routine-role preferences", () => {
  it("reads empty and product-only history without producing a preference", async () => {
    const repository = createUsageRepository(clientWithRows([
      row([]),
      row([]),
    ]));

    await expect(repository.getRoutineRolePreferences(userId, "am")).resolves.toEqual([]);
  });

  it("uses the preference's own period and does not leak AM into PM", async () => {
    const rows = [row([
      { scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" },
      { scope: "routine_role", period: "pm", routine_role: "cleanser", polarity: "prefer" },
    ])];

    await expect(createUsageRepository(clientWithRows(rows)).getRoutineRolePreferences(userId, "am"))
      .resolves.toEqual([{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" }]);
    await expect(createUsageRepository(clientWithRows(rows)).getRoutineRolePreferences(userId, "pm"))
      .resolves.toEqual([{ scope: "routine_role", period: "pm", routine_role: "cleanser", polarity: "prefer" }]);
  });

  it("keeps the newest preference for each routine role", async () => {
    const repository = createUsageRepository(clientWithRows([
      row([{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "prefer" }], "2026-09-17"),
      row([{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" }], "2026-09-16"),
    ]));

    await expect(repository.getRoutineRolePreferences(userId, "am")).resolves.toEqual([
      { scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "prefer" },
    ]);
  });

  it("ignores malformed stored preferences without failing the Today read", async () => {
    const repository = createUsageRepository(clientWithRows([
      row([{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "sometimes" }]),
    ]));

    await expect(repository.getRoutineRolePreferences(userId, "am")).resolves.toEqual([]);
  });
});

function row(routineRolePreferences: unknown[], usedDate = "2026-09-17") {
  return {
    routine_role_preferences: routineRolePreferences,
    used_date: usedDate,
    created_at: `${usedDate}T08:00:00.000Z`,
  };
}

function clientWithRows(rows: ReturnType<typeof row>[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    contains: () => { throw new Error("JSONB contains filter must not be used"); },
    order: () => builder,
    limit: async () => ({ data: rows, error: null }),
  };
  return { from: () => builder } as never;
}
