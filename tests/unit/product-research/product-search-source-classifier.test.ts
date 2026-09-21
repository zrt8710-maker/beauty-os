import { describe, expect, it } from "vitest";

import { classifyProductSearchResult, classifyProductSearchResults, classifySourcePriority } from "@/server/product-search/product-search-source-classifier";

const source = (title: string, url = "https://example.test/product", snippet: string | null = null) => ({
  title, url, snippet, summary: null, site_name: null, rank_score: null, authority_level: null, authority_description: null,
});

describe("Product search source classifier", () => {
  it("keeps an unresolved 羽素 II / 进阶型 lead variant-uncertain", () => {
    expect(classifyProductSearchResult(
      { brand_name: "羽素", product_name: "胶态硫祛痘精华液Ⅱ", variant_name: null },
      source("羽素胶态硫祛痘精华液（进阶型）", "https://www.taobao.com/item", "产品名称：羽素胶态硫祛痘精华液Ⅱ"),
    )).toBe("exact_variant_uncertain");
  });

  it("blocks explicit wrong variants and product-line supersets", () => {
    expect(classifyProductSearchResult(
      { brand_name: "羽素", product_name: "胶态硫祛痘精华液Ⅱ", variant_name: null },
      source("羽素胶态硫祛痘精华液Ⅲ"),
    )).toBe("wrong_variant");
    expect(classifyProductSearchResult(
      { brand_name: "芙清", product_name: "焕颜美肤洁面乳", variant_name: null },
      source("芙清密钥水杨酸焕颜美肤洁面乳"),
    )).toBe("wrong_product_line");
  });

  it("does not treat a generic official flagship page as a wrong product line", () => {
    expect(classifyProductSearchResult(
      { brand_name: "颐莲", product_name: "玻尿酸保湿喷雾", variant_name: null },
      source("颐莲官方旗舰店", "https://www.taobao.com/list/dianpu/68466506.htm"),
    )).toBe("generic_brand_page");
  });

  it("does not block an official product page because its SEO title contains generic brand copy", () => {
    expect(classifyProductSearchResult(
      { brand_name: "至本", product_name: "舒颜修护洁面乳", variant_name: null },
      source("产品中心至本护肤品-至本洗面奶-至本官方网站", "https://www.zhiben.cn/products/cleanser", "至本舒颜修护洁面乳"),
    )).toBe("exact_product");
  });

  it.each([
    ["6.0舒缓版", "5.0保湿版"],
    ["V6", "V5"],
    ["第六代", "第五代"],
    ["Ⅱ", "Ⅲ"],
  ])("recognizes numeric, V, Chinese-generation and Roman variant markers: %s vs %s", (expected, observed) => {
    expect(classifyProductSearchResult(
      { brand_name: "至本", product_name: "舒颜修护洁面乳", variant_name: expected },
      source(`至本舒颜修护洁面乳 ${observed}`),
    )).toBe("wrong_variant");
  });

  it("keeps a versioned source uncertain for a generic Catalog identity without creating that variant", () => {
    expect(classifyProductSearchResult(
      { brand_name: "至本", product_name: "舒颜修护洁面乳", variant_name: null },
      source("至本舒颜修护洁面乳 6.0舒缓版"),
    )).toBe("exact_variant_uncertain");
  });

  it("derives source priority separately from an exact-product match", () => {
    expect(classifySourcePriority(source("玻尿酸深层补水喷雾 - 品牌官网产品页", "http://www.rellet.com/product-detail?id=1"))).toBe("official_product");
    expect(classifySourcePriority(source("CeraVe Moisturizing Cream", "https://www.taobao.com/item"))).toBe("retail");
  });

  it("matches a persisted English identity alias without changing the canonical identity", () => {
    const [classified] = classifyProductSearchResults({
      brand_name: "兰蔻（Lancôme）",
      product_name: "超极光活粹晶露",
      variant_name: null,
      aliases: ["Clarifique Double Treatment Essence"],
      identity_sources: [{
        url: "https://www.lancome-usa.com/skincare/by-category/toners/clarifique-double-treatment-essence/00369-LAC.html",
        source_type: "official_product_page",
      }],
    }, [source(
      "Clarifique Double Treatment Essence",
      "https://www.lancome-usa.com/skincare/by-category/toners/clarifique-double-treatment-essence/00369-LAC.html",
    )]);

    expect(classified).toMatchObject({
      source_class: "exact_product",
      source_priority: "official_product",
      classifier_reason: "confirmed_alias_match",
      matched_name_or_alias: "Clarifique Double Treatment Essence",
      brand_owned_domain: true,
    });
  });

  it("uses a confirmed Chinese alias on an established brand-owned content domain", () => {
    const [classified] = classifyProductSearchResults({
      brand_name: "兰蔻（Lancôme）",
      product_name: "超极光活粹晶露",
      variant_name: null,
      aliases: ["极光水"],
      identity_sources: [{ url: "https://www.lancome.com.tw/product/A03421-LAC.html", source_type: "official_product_page" }],
    }, [source("化妆水成分解析：推荐 Lancome 极光水", "https://www.lancome.com.tw/o-blog/clx-recommend.html")]);

    expect(classified).toMatchObject({
      source_class: "exact_product",
      source_priority: "brand_owner",
      classifier_reason: "confirmed_alias_match",
      brand_owned_domain: true,
    });
  });

  it("does not downgrade a current brand-owned exact product page for an isolated decimal marker", () => {
    const identity = {
      brand_name: "兰蔻（Lancôme）",
      product_name: "超极光活粹晶露",
      variant_name: null,
      aliases: ["极光水"],
      identity_sources: [{ url: "https://www.lancome.com.tw/product/A03421-LAC.html", source_type: "official_product_page" }],
    };
    const [classified] = classifyProductSearchResults(identity, [source(
      "超极光活粹晶露（极光水）",
      "https://www.lancome.com.tw/product/A03421-LAC.html",
      "用户评分 2.0，当前产品页面",
    )]);

    expect(classified).toMatchObject({
      source_class: "exact_product",
      source_priority: "official_product",
      classifier_reason: "current_brand_owned_product_page_marker_ignored",
      observed_variant_markers: ["2.0"],
    });
  });

  it.each(["3.4% Glycolic Acid", "5% acid", "1.5％ 水杨酸", "pH 3.4 配方"])("does not treat a formula measurement as a product variant: %s", (formulaText) => {
    const [classified] = classifyProductSearchResults({
      brand_name: "YSL",
      product_name: "Pure Shots Lines Away Serum",
      variant_name: null,
      identity_sources: [{ url: "https://www.brand.example/products/lines-away", source_type: "官方产品页" }],
    }, [source(
      "YSL Pure Shots Lines Away Serum",
      "https://www.brand.example/products/lines-away",
      formulaText,
    )]);

    expect(classified).toMatchObject({
      source_class: "exact_product",
      source_priority: "official_product",
      observed_variant_markers: [],
      brand_owned_domain: true,
    });
  });

  it("keeps explicit generation language variant-uncertain", () => {
    expect(classifyProductSearchResult(
      { brand_name: "YSL", product_name: "Pure Shots Lines Away Serum", variant_name: null },
      source("YSL Pure Shots Lines Away Serum 第2代"),
    )).toBe("exact_variant_uncertain");
  });

  it("normalizes trusted identity source taxonomy without promoting lookalike or third-party domains", () => {
    const identity = {
      brand_name: "YSL",
      product_name: "Pure Shots Lines Away Serum",
      variant_name: null,
      identity_sources: [{ url: "https://www.brand.example/products/lines-away", source_type: "官方产品页" }],
    };
    const classified = classifyProductSearchResults(identity, [
      source("YSL Pure Shots Lines Away Serum", "https://www.brand.example/products/lines-away"),
      source("YSL Pure Shots Lines Away Serum", "https://www.yslbeauty-untrusted.example/products/lines-away"),
      source("YSL Pure Shots Lines Away Serum 使用分享", "https://blog.example/ysl-lines-away"),
    ]);

    expect(classified[0]).toMatchObject({ source_class: "exact_product", source_priority: "official_product", brand_owned_domain: true });
    expect(classified[1]).toMatchObject({ source_class: "exact_product", source_priority: "unknown", brand_owned_domain: false });
    expect(classified[2]).toMatchObject({ source_class: "exact_product", source_priority: "third_party", brand_owned_domain: false });
  });

  it("keeps an explicit discontinued version uncertain on a brand-owned domain", () => {
    const [classified] = classifyProductSearchResults({
      brand_name: "兰蔻（Lancôme）",
      product_name: "超极光活粹晶露",
      variant_name: null,
      aliases: ["Clarifique Exfoliating Face Essence"],
      identity_sources: [{ url: "https://www.lancome-usa.com/skincare/product/current.html", source_type: "official_product_page" }],
    }, [source(
      "Clarifique Exfoliating Face Essence",
      "https://www.lancome-usa.com/discontinued-products/clarifique-exfoliating-face-essence/00269-LAC.html",
    )]);

    expect(classified).toMatchObject({
      source_class: "exact_variant_uncertain",
      classifier_reason: "explicit_variant_without_catalog_variant",
      brand_owned_domain: true,
    });
  });

  it("blocks another product line on an established brand-owned product domain", () => {
    const [classified] = classifyProductSearchResults({
      brand_name: "兰蔻（Lancôme）",
      product_name: "超极光活粹晶露",
      variant_name: null,
      aliases: ["Clarifique Double Treatment Essence"],
      identity_sources: [{ url: "https://www.lancome-usa.com/skincare/product/current.html", source_type: "official_product_page" }],
    }, [source(
      "Absolue L'Extrait Elixir Lotion",
      "https://www.lancome-usa.com/skincare/by-category/toners/absolue-lextrait-elixir-lotion/00142-LAC.html",
    )]);

    expect(classified).toMatchObject({
      source_class: "wrong_product_line",
      classifier_reason: "brand_product_line_mismatch",
      source_priority: "official_product",
    });
  });
});
