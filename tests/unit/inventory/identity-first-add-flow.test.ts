import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("identity-first product add flow", () => {
  it("normalizes manual and image clues before atomic owned-product creation", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/features/inventory/inventory-manager.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('"/api/v1/product-recognition"');
    expect(source).toContain("manualSearchToIdentityClue");
    expect(source).toContain('fetch("/api/v1/product-identity/resolve"');
    expect(source).not.toContain('"/api/v1/product-lookup"');
    expect(source).toContain('fetch("/api/v1/owned-products/with-identity"');
    expect(source).not.toContain('fetch("/api/v1/product-identity/match"');
    expect(source).not.toContain('fetch("/api/v1/products"');
    expect(source).not.toContain('fetch("/api/v1/owned-products",');
    expect(source).toContain("buildIdentityPersistenceFields(assetDraft, resolution)");
    expect(source).not.toContain("identity_status:");
  });

  it("moves a chosen identity candidate directly to personal asset setup", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/features/inventory/inventory-manager.tsx",
      ),
      "utf8",
    );

    expect(source).not.toContain(">直接添加<");
    expect(source).not.toContain('setAddFlowStage("candidate_confirmation")');
    expect(source).toContain("async function chooseLookupCandidate");
    expect(source).toContain('setAddFlowStage("asset_setup")');
    expect(source).toContain('setAddFlowStage("unknown_confirmation")');
    expect(source).not.toContain('setAddFlowStage("asset_details")');
    expect(source).not.toContain("unknownIdentityPatchForLookup(input)");
    expect(source).not.toContain("PUBLIC_PRODUCT_INFO_NOT_FOUND_MESSAGE");
    expect(source).not.toContain("没有找到匹配产品，请确认包装上的产品信息。");
  });

  it("uses photo and name entry points without an incomplete barcode lookup UI", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/features/inventory/inventory-manager.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("拍照识别");
    expect(source).toContain("上传产品照片");
    expect(source).toContain("尽量拍清品牌和产品名称，完整正面包装更容易识别。");
    expect(source).toContain("尽量填写完整产品名称，品牌也会帮助更快找到产品。");
    expect(source).toContain("正在读取包装信息…");
    expect(source).toContain("正在查找产品…");
    expect(source).toContain("正在确认产品信息，可能需要一点时间…");
    expect(source).toContain("正在确认产品信息…");
    expect(source).toContain("已添加到我的产品");
    expect(source).not.toContain("更多方式");
    expect(source).not.toContain("使用条形码查找");
    expect(source).not.toContain('lookupMode === "barcode"');
    expect(source).not.toContain("品牌 / 名称");
  });

  it("keeps the legacy product and owned-product APIs for compatibility", async () => {
    await expect(
      access(path.join(process.cwd(), "src/app/api/v1/products/route.ts")),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(process.cwd(), "src/app/api/v1/owned-products/route.ts")),
    ).resolves.toBeUndefined();
  });

  it("does not turn schema or programming faults into pending-asset business fallback", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/features/inventory/inventory-manager.tsx"),
      "utf8",
    );
    const failureBoundary = source.slice(
      source.indexOf("function reportIdentityResolutionFailure"),
      source.indexOf("async function rejectLookupCandidates"),
    );

    expect(source).toContain('reportIdentityResolutionFailure("schema"');
    expect(source).toContain('reportIdentityResolutionFailure("programming"');
    expect(failureBoundary).toContain('setAddFlowStage("lookup")');
    expect(failureBoundary).not.toContain("enterUnknownConfirmation");
  });
});
