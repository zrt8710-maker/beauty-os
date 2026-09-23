import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "@/app/api/v1/catalog-products/[catalogProductId]/image/route";

const catalogProductId = "20000000-0000-4000-8000-000000000001";

function context(id = catalogProductId) {
  return { params: Promise.resolve({ catalogProductId: id }) };
}

function catalogRow(catalog_image_url: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { catalog_image_url }, error: null });
  const inStatus = vi.fn().mockReturnValue({ maybeSingle });
  const eq = vi.fn().mockReturnValue({ in: inStatus });
  const select = vi.fn().mockReturnValue({ eq });
  mocks.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) });
  return { eq, inStatus };
}

afterEach(() => vi.unstubAllGlobals());

describe("Catalog product image proxy", () => {
  it("serves the image for its exact Catalog ID with shared cache headers", async () => {
    const query = catalogRow("https://images.example/product.png");
    const fetchImage = vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "content-type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchImage);

    const response = await GET(new Request("https://beauty.example/image"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
    expect(query.eq).toHaveBeenCalledWith("id", catalogProductId);
    expect(query.inStatus).toHaveBeenCalledWith("status", ["candidate", "verified"]);
    expect(fetchImage).toHaveBeenCalledWith(new URL("https://images.example/product.png"), expect.objectContaining({ redirect: "error" }));
  });

  it("does not fetch an absent Catalog image", async () => {
    catalogRow(null);
    const fetchImage = vi.fn();
    vi.stubGlobal("fetch", fetchImage);

    const response = await GET(new Request("https://beauty.example/image"), context());

    expect(response.status).toBe(404);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("rejects private hosts before making an outbound request", async () => {
    catalogRow("https://127.0.0.1/private.png");
    const fetchImage = vi.fn();
    vi.stubGlobal("fetch", fetchImage);

    const response = await GET(new Request("https://beauty.example/image"), context());

    expect(response.status).toBe(502);
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
