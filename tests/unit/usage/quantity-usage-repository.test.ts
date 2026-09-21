import { describe, expect, it, vi } from "vitest";

import { createUsageRepository } from "@/server/repositories/usage-repository";

describe("UsageRepository quantity reminder projection", () => {
  it("uses one lightweight batch query and returns only owned-product/date evidence", async () => {
    const calls: Array<[string, unknown?]> = [];
    const builder = {
      select: vi.fn((selection: string) => {
        calls.push(["select", selection]);
        return builder;
      }),
      eq: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => ({
        data: [
          { owned_product_id: "owned-a", usage: { used_date: "2026-09-15" } },
          { owned_product_id: "owned-b", usage: [{ used_date: "2026-09-14" }] },
        ],
        error: null,
      })),
    };
    const from = vi.fn(() => builder);
    const repository = createUsageRepository({ from } as never);

    await expect(repository.listRecentQuantityUsage("user-a", "2026-08-18"))
      .resolves.toEqual([
        { ownedProductId: "owned-a", usedDate: "2026-09-15" },
        { ownedProductId: "owned-b", usedDate: "2026-09-14" },
      ]);

    expect(from).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("usage_history_products");
    expect(calls).toEqual([[
      "select",
      "owned_product_id,usage:usage_history!inner(used_date)",
    ]]);
  });
});
