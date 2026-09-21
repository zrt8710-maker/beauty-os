import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Purchase Advisor Lite presentation", () => {
  it("uses the four user-facing sections without exposing scores", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/features/purchase-advisor/purchase-advisor.tsx"),
      "utf8",
    );

    for (const heading of ["为什么", "和现有资产的关系", "与你的匹配", "购买前想一想"]) {
      expect(source).toContain(heading);
    }
    expect(source).not.toContain("最终评分 / 100");
    expect(source).not.toContain("function Score");
    expect(source).not.toContain("analysis.final_score");
    expect(source).not.toContain("UNUSED_INVENTORY_PRESSURE");
    expect(source).not.toContain("多件同类产品尚未使用");
  });

  it("accepts only an optional brand and required product name, then uses confirmed Catalog identity", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/features/purchase-advisor/purchase-advisor.tsx"),
      "utf8",
    );

    for (const label of ["想买什么？", "品牌（可选）", "产品名称", "判断值不值得买"]) {
      expect(source).toContain(label);
    }
    for (const removed of ["选择产品", "手工输入", "产品类型", "已知成分", "catalogProducts", "candidate_snapshot: {"]) {
      expect(source).not.toContain(removed);
    }
    expect(source).toContain('fetch("/api/v1/product-identity/resolve"');
    expect(source).toContain('fetch("/api/v1/product-identity/confirm"');
    expect(source).toContain('JSON.stringify({ catalog_product_id: catalogProductId })');
    expect(source).toContain('disabled={busy || !productName.trim()}');
    expect(source).toContain('resolution.status === "catalog_candidates"');
    expect(source).toContain('resolution.status === "external_candidate"');
    expect(source).not.toContain("/api/v1/owned-products/with-identity");
  });
});
