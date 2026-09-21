import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  createRepository: vi.fn(),
  createService: vi.fn(),
}));

vi.mock("@/server/auth/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/require-admin")>();
  return { ...actual, requireAdmin: mocks.requireAdmin };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/server/repositories/product-research-draft-repository", () => ({ createProductResearchDraftRepository: mocks.createRepository }));
vi.mock("@/server/services/admin-product-knowledge-maintenance-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/admin-product-knowledge-maintenance-service")>();
  return { ...actual, createAdminProductKnowledgeMaintenanceService: mocks.createService };
});

import { PATCH } from "@/app/api/v1/admin/knowledge/products/[catalogProductId]/route";
import { AdminRequiredError } from "@/server/auth/require-admin";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const save = vi.fn();

describe("Admin Product Knowledge maintenance API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-id", appRole: "admin" });
    mocks.createAdminClient.mockReturnValue({});
    mocks.createRepository.mockReturnValue({});
    mocks.createService.mockReturnValue({ save });
    save.mockResolvedValue({ id: "draft-2", created_by: "admin", research_version: 2 });
  });

  it("requires Admin before composing a repository or saving", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());
    const response = await PATCH(request(edit()), params());

    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves only the editable maintenance payload through the versioning service", async () => {
    const body = edit();
    const response = await PATCH(request(body), params());

    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(catalogProductId, body);
    await expect(response.json()).resolves.toEqual({ data: { id: "draft-2", created_by: "admin", research_version: 2 } });
  });
});

function params() { return { params: Promise.resolve({ catalogProductId }) }; }
function request(body: unknown) { return new Request("http://localhost/api/v1/admin/knowledge/products/" + catalogProductId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
function edit() { return { overall_confidence: 72, ingredients: { status: "unknown", raw_text: [], item_names: [] }, claims: [], product_type: null, texture: null, usage: { instructions: [], am_pm: [], frequency: null, routine_order: null, leave_on: null, rinse_off: null, cautions: [] } }; }
