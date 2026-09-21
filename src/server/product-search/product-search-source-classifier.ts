import "server-only";

import type { ProductSearchResult } from "@/schemas/product-search";

export const PRODUCT_SEARCH_SOURCE_CLASSES = [
  "exact_product",
  "exact_variant_uncertain",
  "wrong_variant",
  "wrong_product_line",
  "generic_brand_page",
  "aggregation_or_retail",
  "third_party_content",
  "unknown",
] as const;

export type ProductSearchSourceClass = typeof PRODUCT_SEARCH_SOURCE_CLASSES[number];
export type ProductSearchSourcePriority = "official_product" | "brand_owner" | "official_store" | "retail" | "aggregation" | "third_party" | "unknown";
export type SourceClassifierReason =
  | "canonical_name_match"
  | "confirmed_alias_match"
  | "current_brand_owned_product_page_marker_ignored"
  | "explicit_variant_conflict"
  | "explicit_variant_without_catalog_variant"
  | "brand_product_line_mismatch"
  | "brand_generic_page"
  | "aggregation_or_retail"
  | "third_party_content"
  | "no_supported_identity_match";

export type ClassifiedProductSearchResult = ProductSearchResult & {
  source_class: ProductSearchSourceClass;
  source_priority: ProductSearchSourcePriority;
  classifier_reason: SourceClassifierReason;
  matched_name_or_alias: string | null;
  observed_variant_markers: string[];
  brand_owned_domain: boolean;
};

type IdentitySource = { url: string; source_type: string | null };
type CanonicalOfficialIdentitySourceType = "official_brand" | "brand_owner" | "official_product_page" | "official_website";
type Identity = {
  brand_name: string;
  product_name: string;
  variant_name: string | null;
  aliases?: string[];
  identity_sources?: IdentitySource[];
};

type ClassificationDetail = Pick<ClassifiedProductSearchResult,
  "source_class" | "source_priority" | "classifier_reason" | "matched_name_or_alias" | "observed_variant_markers" | "brand_owned_domain">;

export function classifyProductSearchResults(identity: Identity, results: ProductSearchResult[]): ClassifiedProductSearchResult[] {
  return results.map((result) => ({ ...result, ...classifyProductSearchResultDetail(identity, result) }));
}

export function classifyProductSearchResult(identity: Identity, result: ProductSearchResult): ProductSearchSourceClass {
  return classifyProductSearchResultDetail(identity, result).source_class;
}

export function classifySourcePriority(result: ProductSearchResult, identity?: Identity): ProductSearchSourcePriority {
  const url = result.url.toLowerCase();
  const title = `${result.title} ${result.site_name ?? ""}`.toLowerCase();
  if (identity && isBrandOwnedDomain(identity, result.url)) {
    return looksProductDetailPage(result) ? "official_product" : "brand_owner";
  }
  if (/(official|官网|官方网站|品牌官网|product-detail)/.test(title) || /(^|\.)rellet\.com\//.test(url)) return "official_product";
  if (/(品牌所属企业|母公司)/.test(title) || /lshfreda\.com/.test(url)) return "brand_owner";
  if (/(官方旗舰店|official flagship)/.test(title)) return "official_store";
  if (/(suning\.com|jd\.com|taobao\.com|tmall\.com|shihuo\.cn)/.test(url)) return "retail";
  if (/(聚合|搜索|榜|导购|smzdm|wangaiche)/.test(title) || /(smzdm\.com|wangaiche\.com)/.test(url)) return "aggregation";
  if (/(beaut\.taobao\.com|blog|forum|club\.jd\.com)/.test(url)) return "third_party";
  return "unknown";
}

function classifyProductSearchResultDetail(identity: Identity, result: ProductSearchResult): ClassificationDetail {
  const title = normalize(result.title);
  const content = normalize(`${result.title}\n${result.snippet ?? ""}\n${result.summary ?? ""}`);
  const brand = normalize(identity.brand_name);
  const product = normalize(identity.product_name);
  const brandOwnedDomain = isBrandOwnedDomain(identity, result.url);
  const sourcePriority = classifySourcePriority(result, identity);
  const observedMarkers = variantMarkers(`${result.title} ${result.snippet ?? ""}`);
  const base = { source_priority: sourcePriority, observed_variant_markers: observedMarkers, brand_owned_domain: brandOwnedDomain };
  if (!brand || !product) {
    return { ...base, source_class: "unknown", classifier_reason: "no_supported_identity_match", matched_name_or_alias: null };
  }

  const matchedName = matchedProductName(identity, content);
  if (matchedName) {
    const matchedProduct = normalize(matchedName);
    if (!brandOwnedDomain && !["official_product", "brand_owner"].includes(sourcePriority)
      && hasBrandSupersetMismatch(title, brand, matchedProduct)) {
      return { ...base, source_class: "wrong_product_line", classifier_reason: "brand_product_line_mismatch", matched_name_or_alias: matchedName };
    }
    const expectedMarkers = variantMarkers(`${identity.product_name} ${identity.variant_name ?? ""}`);
    const observedTitleMarkers = variantMarkers(result.title);
    if (expectedMarkers.length === 0 && hasLifecycleConflict(result)) {
      return {
        ...base,
        source_class: "exact_variant_uncertain",
        classifier_reason: "explicit_variant_without_catalog_variant",
        matched_name_or_alias: matchedName,
      };
    }
    if (expectedMarkers.length && observedMarkers.some((marker) => !expectedMarkers.includes(marker))) {
      return { ...base, source_class: "wrong_variant", classifier_reason: "explicit_variant_conflict", matched_name_or_alias: matchedName };
    }
    if (expectedMarkers.length && !expectedMarkers.every((marker) => observedTitleMarkers.includes(marker))) {
      return { ...base, source_class: "exact_variant_uncertain", classifier_reason: "explicit_variant_conflict", matched_name_or_alias: matchedName };
    }
    if (expectedMarkers.length === 0 && observedMarkers.length > 0) {
      if (isCurrentBrandOwnedProductPage(identity, result) && !hasExplicitVariantOrLifecycleConflict(result, observedMarkers)) {
        return {
          ...base,
          source_class: "exact_product",
          classifier_reason: "current_brand_owned_product_page_marker_ignored",
          matched_name_or_alias: matchedName,
        };
      }
      return {
        ...base,
        source_class: "exact_variant_uncertain",
        classifier_reason: "explicit_variant_without_catalog_variant",
        matched_name_or_alias: matchedName,
      };
    }
    return {
      ...base,
      source_class: "exact_product",
      classifier_reason: normalize(matchedName) === product ? "canonical_name_match" : "confirmed_alias_match",
      matched_name_or_alias: matchedName,
    };
  }

  if (brandOwnedDomain && looksProductDetailPage(result)) {
    return { ...base, source_class: "wrong_product_line", classifier_reason: "brand_product_line_mismatch", matched_name_or_alias: null };
  }
  if ((brandForms(identity.brand_name).some((item) => content.includes(item)) || brandOwnedDomain) && looksGenericBrandPage(result)) {
    return { ...base, source_class: "generic_brand_page", classifier_reason: "brand_generic_page", matched_name_or_alias: null };
  }
  if (looksAggregationOrRetail(result)) {
    return { ...base, source_class: "aggregation_or_retail", classifier_reason: "aggregation_or_retail", matched_name_or_alias: null };
  }
  if (looksThirdParty(result)) {
    return { ...base, source_class: "third_party_content", classifier_reason: "third_party_content", matched_name_or_alias: null };
  }
  return { ...base, source_class: "unknown", classifier_reason: "no_supported_identity_match", matched_name_or_alias: null };
}

function matchedProductName(identity: Identity, content: string) {
  const candidates = [identity.product_name, ...(identity.aliases ?? [])]
    .map((value) => value.trim())
    .filter((value, index, values) => normalize(value).length >= 3
      && values.findIndex((candidate) => normalize(candidate) === normalize(value)) === index);
  return candidates.find((candidate) => {
    const normalized = normalize(candidate);
    if (content.includes(normalized) || productCoreMatches(content, normalized)) return true;
    const candidateMarkers = variantMarkers(candidate);
    if (candidateMarkers.length === 0) return false;
    const candidateWithoutMarkers = removeVariantMarkers(normalized, candidateMarkers);
    const contentWithoutMarkers = removeVariantMarkers(content, variantMarkers(content));
    return contentWithoutMarkers.includes(candidateWithoutMarkers)
      || productCoreMatches(contentWithoutMarkers, candidateWithoutMarkers);
  }) ?? null;
}

function removeVariantMarkers(value: string, markers: string[]) {
  return markers.reduce((output, marker) => output.replaceAll(normalize(marker), ""), value);
}

function isBrandOwnedDomain(identity: Identity, url: string) {
  const resultHost = hostname(url);
  if (!resultHost) return false;
  return trustedBrandOwnedDomains(identity).some((domain) => resultHost === domain || resultHost.endsWith(`.${domain}`));
}

function trustedBrandOwnedDomains(identity: Identity) {
  return [...new Set((identity.identity_sources ?? [])
    .filter((source) => canonicalOfficialIdentitySourceType(source.source_type) !== null)
    .map((source) => hostname(source.url))
    .filter((value): value is string => Boolean(value))
    .map(stripPresentationSubdomain))];
}

export function canonicalOfficialIdentitySourceType(value: string | null): CanonicalOfficialIdentitySourceType | null {
  if (value === null) return null;
  const normalized = value.trim().toLocaleLowerCase("zh-CN").replace(/[\s-]+/gu, "_");
  if (/^(official_brand|brand_official|品牌官网产品中心|品牌官方)$/u.test(normalized)) return "official_brand";
  if (/^(brand_owner|品牌方|品牌自有|品牌所有者)$/u.test(normalized)) return "brand_owner";
  if (/^(official_product_page|official_product|official|官方产品页|官网产品页)$/u.test(normalized)) return "official_product_page";
  if (/^(official_website|brand_website|官方网站|品牌官网|官网)$/u.test(normalized)) return "official_website";
  return null;
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stripPresentationSubdomain(host: string) {
  return host.replace(/^(?:www|zh|en|cn|tw)\./i, "");
}

function isCurrentBrandOwnedProductPage(identity: Identity, result: ProductSearchResult) {
  return isBrandOwnedDomain(identity, result.url)
    && looksProductDetailPage(result)
    && !hasLifecycleConflict(result);
}

function looksProductDetailPage(result: ProductSearchResult) {
  const value = `${result.title} ${result.url}`.toLowerCase();
  return /(product-detail|\/products?\/|\/by-category\/|\/item\/|\/p\/|[a-z]\d{4,}-lac\.html|\/\d{4,}[^/]*\.html)/i.test(value)
    && !/(\/o-blog\/|\/blog\/|\/collection\/|\/collections\/|产品系列\/?$|產品系列\/?$)/i.test(value);
}

function hasExplicitVariantOrLifecycleConflict(result: ProductSearchResult, markers: string[]) {
  if (hasLifecycleConflict(result)) return true;
  const value = `${result.title} ${result.snippet ?? ""}`.normalize("NFKC").toLocaleLowerCase("zh-CN");
  return markers.some((marker) => {
    if (/^v\d/i.test(marker) || /^第.+代$/u.test(marker) || /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/u.test(marker)) return true;
    const index = value.indexOf(marker.toLocaleLowerCase("zh-CN"));
    const nearby = index < 0 ? value : value.slice(Math.max(0, index - 10), index + marker.length + 10);
    return /(版本|版|代|version|generation|formula|配方|sku|型号)/i.test(nearby);
  });
}

function hasLifecycleConflict(result: ProductSearchResult) {
  return /(旧版|舊版|老版|停售|停产|停產|已下架|discontinued|archived|archive|legacy|previous version)/i
    .test(`${result.title} ${result.snippet ?? ""} ${result.url}`);
}

function normalize(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s\-_()[\]{}（）【】，,。.!！?？:：'’]/g, "");
}

function productCoreMatches(content: string, product: string) {
  const core = product.replace(/(洁面乳|精华液|精华水|晶露|喷雾|面霜|乳液|爽肤水|化妆水|essence)$/u, "");
  return core.length >= 4 && content.includes(core);
}

function variantMarkers(value: string) {
  const romanMarkers = value.match(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+/gu) ?? [];
  const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const decimalMarkers = normalized.matchAll(/(?<![\d.])\d+\.\d+(?![\d.])/gu);
  const markers = [
    ...(normalized.match(/v\s*\d+(?:\.\d+)?/gu) ?? []).map((item) => item.replace(/\s+/g, "")),
    ...(normalized.match(/第\s*(?:\d+|[一二三四五六七八九十]+)\s*代/gu) ?? []).map((item) => item.replace(/\s+/g, "")),
    ...[...decimalMarkers].filter((match) => !isFormulaMeasurement(normalized, match.index, match[0])).map((match) => match[0]),
    ...romanMarkers,
  ];
  return [...new Set(markers)];
}

function isFormulaMeasurement(value: string, index: number, marker: string) {
  const before = value.slice(Math.max(0, index - 12), index);
  const after = value.slice(index + marker.length, index + marker.length + 12);
  return /(?:ph|浓度|含量|配方)\s*$/iu.test(before)
    || /^\s*(?:%|％|percent\b|ppm\b|mg\b|ml\b|g\b|mol\b|w\/w\b|v\/v\b)/iu.test(after);
}

function brandForms(value: string) {
  const forms = [normalize(value), ...value.split(/[（(\/]/u).map(normalize)].filter((item) => item.length >= 2);
  return [...new Set(forms)];
}

function hasBrandSupersetMismatch(title: string, brand: string, product: string) {
  const position = title.indexOf(brand);
  if (position < 0) return false;
  const following = title.slice(position + brand.length).match(/^[\u4e00-\u9fff]{1,4}/u)?.[0] ?? "";
  if (!following || product.startsWith(following) || following.startsWith(product.slice(0, 1))) return false;
  return /^[\u4e00-\u9fff]{1,4}$/u.test(following) && !product.includes(following);
}

function looksGenericBrandPage(result: ProductSearchResult) {
  const value = `${result.title} ${result.url}`.toLowerCase();
  return /(官网|官方网站|官方旗舰|brand|首页|index|search|店铺|collection|产品系列|產品系列|护肤系列|護膚系列|\/o-blog\/|\/blog\/)/.test(value);
}

function looksAggregationOrRetail(result: ProductSearchResult) {
  return /(淘宝|天猫|京东|苏宁|识货|什么值得买|商品|报价|价格|销量)/.test(`${result.title} ${result.site_name ?? ""}`);
}

function looksThirdParty(result: ProductSearchResult) {
  return /(测评|攻略|分享|资讯|评测|体验|心得|blog|forum)/.test(`${result.title} ${result.site_name ?? ""}`);
}
