import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), from: vi.fn(), update: vi.fn(), maybeSingle: vi.fn() }));

vi.mock("@/server/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));

import { PATCH } from "@/app/api/v1/admin/knowledge/products/[catalogProductId]/image/route";

const id = "10000000-0000-4000-8000-000000000001";

describe("Admin Catalog product image API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin" });
    mocks.update.mockReturnValue({ eq: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })) })) });
    mocks.from.mockReturnValue({ update: mocks.update });
    mocks.maybeSingle.mockResolvedValue({ data: { catalog_image_url: "https://example.com/image.jpg" }, error: null });
  });

  it("allows an Admin to set a vetted HTTPS Catalog image", async () => {
    const response = await PATCH(request({ catalog_image_url: "https://example.com/image.jpg", catalog_image_source_url: "https://example.com/product" }), params());
    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("catalog_products");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ catalog_image_url: "https://example.com/image.jpg", catalog_image_source_url: null }));
  });

  it("allows an Admin to remove both Catalog image fields", async () => {
    const response = await PATCH(request({ catalog_image_url: null, catalog_image_source_url: null }), params());
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ catalog_image_url: null, catalog_image_source_url: null }));
  });

  it("rejects non-HTTPS image URLs", async () => {
    const response = await PATCH(request({ catalog_image_url: "http://example.com/image.jpg", catalog_image_source_url: null }), params());
    expect(response.status).toBe(400);
  });
});

function params() { return { params: Promise.resolve({ catalogProductId: id }) }; }
function request(body: unknown) { return new Request("http://localhost/api/v1/admin/knowledge/products/" + id + "/image", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
