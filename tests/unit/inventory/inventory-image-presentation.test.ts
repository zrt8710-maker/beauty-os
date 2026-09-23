import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../../../src/features/inventory/inventory-manager.tsx", import.meta.url)),
  "utf8",
);
const quantityEditorSource = readFileSync(
  fileURLToPath(new URL("../../../src/features/inventory/quantity-quick-editor.tsx", import.meta.url)),
  "utf8",
);

describe("Inventory image presentation", () => {
  it("treats a missing image as a neutral visual state", () => {
    expect(source).toContain('aria-label="暂无产品图片"');
    expect(source).not.toContain("产品图片占位符");
    expect(source).not.toContain("图片加载失败");
    expect(source).not.toContain("请上传图片");
  });

  it("uses compact mobile imagery, a desktop product stage and a two-line product name", () => {
    expect(source).toContain('className="flex size-[68px] shrink-0');
    expect(source).toContain("beauty-product-stage");
    expect(source).toContain("h-36 w-full");
    expect(source).toContain("object-contain p-4");
    expect(source).toContain("line-clamp-2");
    expect(source).not.toContain('className="relative flex h-40');
  });

  it("defaults to all assets and presents category selection as a client-side filter", () => {
    expect(source).toContain("const [selectedAssetSection, setSelectedAssetSection]");
    expect(source).toContain("? [selectedAssetSection]");
    expect(source).toContain(": ASSET_SECTIONS;");
    expect(source).toContain('aria-label="资产分类筛选"');
    expect(source).toContain("filterInventoryBySection(matchingInventory, section)");
  });

  it("keeps quantity updates explicit and sends only the existing quantity field", () => {
    expect(source).toContain("更新剩余量");
    expect(quantityEditorSource).toContain("QUICK_QUANTITY_VALUES");
    expect(quantityEditorSource).toContain(
      "body: JSON.stringify({ quantity_remaining_percent: quantity })",
    );
    expect(quantityEditorSource).toContain('type="range"');
    expect(quantityEditorSource).toContain("保存剩余量");
  });

  it("keeps unset expiry out of the compact card presentation", () => {
    expect(source).toContain("ownedProduct.expires_on ? (");
    expect(source).toContain("expiry.label");
  });

  it("keeps image management copy user-facing", () => {
    expect(source).toContain("我的产品图片");
    expect(source).toContain("添加我的图片");
    expect(source).toContain("更换我的图片");
    expect(source).toContain("改用产品默认图");
    expect(source).not.toContain("private bucket");
    expect(source).not.toContain("临时查看");
  });

  it("allows a new image URL to render after the previous URL failed", () => {
    expect(source).toContain("const [failedSrc, setFailedSrc]");
    expect(source).toContain("failedSrc === src");
    expect(source).toContain("setFailedSrc(displayedSrc)");
  });
});
