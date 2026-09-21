import "server-only";

import { z } from "zod";

import {
  productSearchInputSchema,
  productSearchResultSchema,
  type ProductSearchInput,
  type ProductSearchResult,
} from "@/schemas/product-search";
import type { ProductSearchProvider } from "@/server/product-search/product-search-provider";

const SEARCH_INFINITY_URL = "https://open.feedcoopapi.com/search_api/web_search";
const RESULTS_PER_QUERY = 5;
const MAX_RESULTS = 10;

const responseSchema = z.object({
  Result: z.object({
    WebResults: z.array(z.object({
      Title: z.string().trim().min(1),
      Url: z.url().optional(),
      Snippet: z.string().nullable().optional(),
      Summary: z.string().nullable().optional(),
      SiteName: z.string().nullable().optional(),
      RankScore: z.number().finite().nullable().optional(),
      AuthInfoLevel: z.number().int().nullable().optional(),
      AuthInfoDes: z.string().nullable().optional(),
    }).passthrough()).optional(),
  }).optional(),
}).passthrough();

export class ProductSearchUnavailableError extends Error {
  readonly code = "PRODUCT_SEARCH_UNAVAILABLE";
  constructor(message = "PRODUCT_SEARCH_UNAVAILABLE") {
    super(message);
    this.name = "ProductSearchUnavailableError";
  }
}

export function createVolcengineSearchInfinityProvider(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  onTiming?: (stage: "search_infinity_primary" | "search_infinity_fallback", elapsedMs: number) => void;
}): ProductSearchProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    providerCode: "volcengine_search_infinity",
    async search(rawInput) {
      const input = productSearchInputSchema.parse(rawInput);
      const primaryStartedAt = performance.now();
      let primary: ProductSearchResult[];
      try {
        primary = await requestSearch(fetchImpl, options.apiKey, input.query ?? primaryQuery(input));
      } finally {
        options.onTiming?.("search_infinity_primary", Math.round(performance.now() - primaryStartedAt));
      }
      const combined = [...primary];
      if (!input.query && isWeak(primary, input)) {
        const fallbackStartedAt = performance.now();
        try {
          combined.push(...await requestSearch(fetchImpl, options.apiKey, fallbackQuery(input)));
        } finally {
          options.onTiming?.("search_infinity_fallback", Math.round(performance.now() - fallbackStartedAt));
        }
      }
      return deduplicate(combined).slice(0, MAX_RESULTS);
    },
  };
}

export function createConfiguredVolcengineSearchInfinityProvider(options?: {
  onTiming?: (stage: "search_infinity_primary" | "search_infinity_fallback", elapsedMs: number) => void;
}): ProductSearchProvider | null {
  const apiKey = process.env.VOLCENGINE_AGENT_PLAN_KEY?.trim();
  return apiKey ? createVolcengineSearchInfinityProvider({ apiKey, ...options }) : null;
}

function primaryQuery(input: ProductSearchInput) {
  return [input.brand, input.product_name, input.variant_name].filter(Boolean).join(" ");
}

function fallbackQuery(input: ProductSearchInput) {
  return [input.brand, input.product_name, input.variant_name, "官方旗舰店 天猫"].filter(Boolean).join(" ");
}

async function requestSearch(fetchImpl: typeof fetch, apiKey: string, query: string): Promise<ProductSearchResult[]> {
  let response: Response;
  try {
    response = await fetchImpl(SEARCH_INFINITY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Traffic-Tag": "beauty_os_product_search",
      },
      body: JSON.stringify({
        Query: query,
        SearchType: "web",
        Count: RESULTS_PER_QUERY,
        Filter: { NeedUrl: true },
      }),
    });
  } catch {
    throw new ProductSearchUnavailableError("PRODUCT_SEARCH_NETWORK_FAILED");
  }
  if (!response.ok) throw new ProductSearchUnavailableError(`PRODUCT_SEARCH_HTTP_${response.status}`);

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ProductSearchUnavailableError("PRODUCT_SEARCH_INVALID_JSON");
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new ProductSearchUnavailableError("PRODUCT_SEARCH_INVALID_RESPONSE");
  return (parsed.data.Result?.WebResults ?? [])
    .flatMap((item) => item.Url ? [productSearchResultSchema.parse({
      title: item.Title,
      url: item.Url,
      snippet: truncate(normalizeText(item.Snippet), 2_000),
      summary: truncate(normalizeText(item.Summary), 4_000),
      site_name: normalizeText(item.SiteName),
      rank_score: item.RankScore ?? null,
      authority_level: item.AuthInfoLevel ?? null,
      authority_description: normalizeText(item.AuthInfoDes),
    })] : []);
}

function normalizeText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function truncate(value: string | null, limit: number) {
  return value && value.length > limit ? value.slice(0, limit) : value;
}

function isWeak(results: ProductSearchResult[], input: ProductSearchInput) {
  if (!results.length) return true;
  const terms = [input.brand, input.product_name, input.variant_name].filter((term): term is string => Boolean(term)).map(normalizeForMatch);
  return !results.some((result) => {
    const candidate = normalizeForMatch(`${result.title}\n${result.snippet ?? ""}`);
    return terms.every((term) => candidate.includes(term));
  });
}

function normalizeForMatch(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s\-_()[\]{}]/g, "");
}

function deduplicate(results: ProductSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
