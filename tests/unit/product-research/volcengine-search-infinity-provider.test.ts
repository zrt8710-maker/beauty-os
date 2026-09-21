import { describe, expect, it, vi } from "vitest";

import {
  ProductSearchUnavailableError,
  createVolcengineSearchInfinityProvider,
} from "@/server/product-search/volcengine-search-infinity-provider";

const input = { brand: "颐莲", product_name: "玻尿酸保湿喷雾", variant_name: null };

function response(results: unknown[]) {
  return new Response(JSON.stringify({ Result: { WebResults: results } }), { status: 200 });
}

const productResult = {
  Title: "颐莲玻尿酸保湿喷雾", Url: "https://example.test/product",
  Snippet: "产品详情", Summary: "保湿喷雾", SiteName: "官方旗舰店",
  RankScore: 0.98, AuthInfoLevel: 1, AuthInfoDes: "官方",
};

describe("Volcengine SearchInfinity product search provider", () => {
  it("uses the documented API-key request and normalizes provider-returned fields", async () => {
    const fetchMock = vi.fn(async () => response([productResult]));
    const provider = createVolcengineSearchInfinityProvider({ apiKey: "test-key", fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(provider.search(input)).resolves.toEqual([{
      title: "颐莲玻尿酸保湿喷雾", url: "https://example.test/product", snippet: "产品详情", summary: "保湿喷雾",
      site_name: "官方旗舰店", rank_score: 0.98, authority_level: 1, authority_description: "官方",
    }]);

    const request = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>)[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({ Query: "颐莲 玻尿酸保湿喷雾", SearchType: "web", Count: 5, Filter: { NeedUrl: true } });
  });

  it("returns an empty lead list when the response has no usable URLs", async () => {
    const provider = createVolcengineSearchInfinityProvider({
      apiKey: "test-key", fetchImpl: vi.fn(async () => response([{ Title: "No URL" }])) as unknown as typeof fetch,
    });
    await expect(provider.search(input)).resolves.toEqual([]);
  });

  it("uses one exact-product fallback query when primary results are weak and caps deduplicated leads", async () => {
    const first = Array.from({ length: 5 }, (_, index) => ({ ...productResult, Title: `generic ${index}`, Url: `https://example.test/first/${index}` }));
    const second = Array.from({ length: 6 }, (_, index) => ({ ...productResult, Title: `颐莲玻尿酸保湿喷雾 ${index}`, Url: `https://example.test/second/${index}` }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response(second));
    const provider = createVolcengineSearchInfinityProvider({ apiKey: "test-key", fetchImpl: fetchMock as unknown as typeof fetch });

    const results = await provider.search(input);
    expect(results).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>)[1]?.[1] as RequestInit;
    expect(JSON.parse(String(secondRequest.body)).Query).toBe("颐莲 玻尿酸保湿喷雾 官方旗舰店 天猫");
  });

  it("uses one bounded application-authored research query without generic fallback", async () => {
    const fetchMock = vi.fn(async () => response([]));
    const provider = createVolcengineSearchInfinityProvider({ apiKey: "test-key", fetchImpl: fetchMock as unknown as typeof fetch });

    await provider.search({ ...input, query: "颐莲 玻尿酸保湿喷雾 官方 使用方法 注意事项" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>)[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).Query).toBe("颐莲 玻尿酸保湿喷雾 官方 使用方法 注意事项");
  });

  it("fails safely for provider HTTP and network failures", async () => {
    const http = createVolcengineSearchInfinityProvider({ apiKey: "test-key", fetchImpl: vi.fn(async () => new Response("bad", { status: 503 })) as unknown as typeof fetch });
    await expect(http.search(input)).rejects.toBeInstanceOf(ProductSearchUnavailableError);
    const network = createVolcengineSearchInfinityProvider({ apiKey: "test-key", fetchImpl: vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    await expect(network.search(input)).rejects.toBeInstanceOf(ProductSearchUnavailableError);
  });
});
