import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminPageAccess: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/server/admin/require-admin-page-access", () => ({
  requireAdminPageAccess: mocks.requireAdminPageAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import KnowledgeAdminPage from "@/app/(app)/admin/knowledge/page";

describe("Knowledge Admin page access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not create a privileged client when the admin guard rejects access", async () => {
    const denied = new Error("ADMIN_REQUIRED");
    mocks.requireAdminPageAccess.mockRejectedValue(denied);

    await expect(KnowledgeAdminPage()).rejects.toBe(denied);

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
