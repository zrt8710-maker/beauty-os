import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CatalogProductImageMaintenance } from "@/features/admin/catalog-product-image-maintenance";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("Catalog product image maintenance", () => {
  it("renders a canonical Catalog image when present", () => {
    const html = renderToStaticMarkup(<CatalogProductImageMaintenance
      catalogProductId="10000000-0000-4000-8000-000000000001"
      initialImageUrl="https://example.com/product.jpg"
    />);
    expect(html).toContain("https://example.com/product.jpg");
    expect(html).toContain("更换图片");
    expect(html).toContain("移除图片");
  });

  it("renders a neutral placeholder when no Catalog image exists", () => {
    const html = renderToStaticMarkup(<CatalogProductImageMaintenance
      catalogProductId="10000000-0000-4000-8000-000000000001"
      initialImageUrl={null}
    />);
    expect(html).toContain("产品图片占位符");
  });
});
