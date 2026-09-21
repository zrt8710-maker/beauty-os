import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductKnowledgeMaintenanceForm } from "@/features/admin/product-knowledge-maintenance-form";
import type { ProductKnowledgeCompleteness } from "@/server/services/product-knowledge-completeness-service";
import { productResearchDraftFixture } from "../../support/product-research-draft-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const product = {
  id: "10000000-0000-4000-8000-000000000001", brand_name: "HFP", product_name: "果酸毛孔净透精华水", variant_name: null, barcode: null,
  category: null, subcategory: null, product_type: null, confidence: 70, status: "candidate" as const,
  created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z",
};
const completeness: ProductKnowledgeCompleteness = {
  overall: "usable", source_quality: "strong", suggested_actions: [],
  fields: { identity: "complete", variant: "complete", product_type: "complete", ingredients: "complete", claims: "complete", texture: "complete", usage: "partial", cautions: "missing", uncertainties_conflicts: "complete" },
};

describe("Product Knowledge maintenance UI", () => {
  it("renders a readable ingredient text box and collapsed raw source", () => {
    const base = productResearchDraftFixture().research_payload;
    const snapshot = productResearchDraftFixture({ research_payload: {
      ...base,
      ingredients: { ...base.ingredients, status: "partial", raw_text: ["Aqua, Panthenol"], items: [{ raw_name: "Aqua", normalized_name: "AQUA", ingredient_order: 1, confidence: 80, evidence_refs: ["source_1"] }] },
      usage: { ...base.usage, instructions: ["Apply after cleansing"], cautions: [] },
      uncertainties: [{ field: "ingredients.formula_version", description: "当前与停售配方列表存在差异。", evidence_refs: ["source_1"] }],
    } });
    const html = renderToStaticMarkup(<ProductKnowledgeMaintenanceForm catalogProductId={product.id} completeness={completeness} snapshot={snapshot} />);

    expect(html).toContain("研究可信度");
    expect(html).toContain("不是资料完整度评分");
    expectCanonicalSectionOrder(html);
    expect(html).toContain("min-h-44 w-full");
    expect(html).toContain("成分列表");
    expect(html).toContain("Aqua");
    expect(html).toContain("现有结构化成分事实均有来源支持");
    expect(html).not.toContain("尚未确认完整 INCI 声明");
    expect(html).not.toContain("成分仅部分获取");
    expect(html).toContain("中文可读成分列表");
    expect(html).not.toContain("编辑原始名称");
    expect(html).toContain("使用方法与注意事项");
    expect(html).toContain("当前缺失资料");
    expect(html).toContain("当前不确定信息");
    expect(html).toContain("当前与停售配方列表存在差异");
    expect(html).toContain("HomeFacialPro（source_1）");
    expect(html).toContain("来源信息冲突");
    expect(html).toContain("暂无已发现的资料冲突");
    expect(html).not.toContain("发布");
  });

  it("keeps the same maintenance editor structure when research is absent", () => {
    const html = renderToStaticMarkup(<ProductKnowledgeMaintenanceForm catalogProductId={product.id} completeness={completeness} snapshot={null} />);

    expectCanonicalSectionOrder(html);
    expect(html).toContain("原始成分声明");
    expect(html).toContain("查看原始来源文本");
    expect(html).toContain("使用方法与注意事项");
    expect(html).toContain("尚无可编辑的研究快照");
  });
});

function expectCanonicalSectionOrder(html: string) {
  const headings = [
    "研究可信度",
    "成分",
    "公开宣称",
    "产品类型",
    "质地",
    "使用方法与注意事项",
    "当前缺失资料",
    "当前不确定信息",
    "来源信息冲突",
    "保存修改",
  ];
  let previousIndex = -1;
  for (const heading of headings) {
    const index = html.indexOf(heading, previousIndex + 1);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}
