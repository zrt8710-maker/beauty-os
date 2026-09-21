import { describe, expect, it, vi } from "vitest";

import type { ProductDiscoveryProvider } from "@/server/integrations/product-discovery/provider";
import {
  CriticalProductDiscoveryProviderError,
  createProductDiscoveryService,
} from "@/server/services/product-discovery-service";

describe("ProductDiscoveryService", () => {
  it("normalizes the request, calls the provider, and returns a stable result", async () => {
    const provider = providerStub();
    provider.search = vi.fn().mockResolvedValue({
      provider_code: "internal_catalog",
      status: "not_found",
      candidates: [],
      issues: [],
    });
    const service = createProductDiscoveryService([provider]);

    const result = await service.search({
      schema_version: "product-discovery/v0.1",
      mode: "barcode",
      barcode: "4006-3813-3393-1",
    });

    expect(provider.search).toHaveBeenCalledWith({
      schema_version: "product-discovery/v0.1",
      mode: "barcode",
      barcode: "4006381333931",
      locale: "zh-CN",
      market: "CN",
      limit: 10,
    });
    expect(result).toMatchObject({
      result_version: "product-discovery-result/v0.1",
      status: "no_match",
      candidates: [],
    });
  });

  it("fails closed when the critical internal provider fails", async () => {
    const provider = providerStub();
    provider.search = vi.fn().mockRejectedValue(new Error("db sentinel"));
    const service = createProductDiscoveryService([provider]);

    await expect(service.search({
      schema_version: "product-discovery/v0.1",
      mode: "name",
      brand_name: "Beauty OS",
      product_name: "Daily Serum",
    })).rejects.toBeInstanceOf(CriticalProductDiscoveryProviderError);
  });

  it("isolates a non-critical future provider failure", async () => {
    const internal = providerStub();
    internal.search = vi.fn().mockResolvedValue({
      provider_code: "internal_catalog",
      status: "not_found",
      candidates: [],
      issues: [],
    });
    const future = providerStub({
      providerCode: "future_provider",
      critical: false,
    });
    future.search = vi.fn().mockRejectedValue(new Error("network sentinel"));

    const result = await createProductDiscoveryService([
      internal,
      future,
    ]).search({
      schema_version: "product-discovery/v0.1",
      mode: "name",
      product_name: "Daily Serum",
    });

    expect(result.status).toBe("no_match");
    expect(result.provider_results[1]).toMatchObject({
      provider_code: "future_provider",
      status: "failed",
      candidates: [],
    });
    expect(JSON.stringify(result)).not.toContain("network sentinel");
  });
});

function providerStub(
  patch: Partial<ProductDiscoveryProvider> = {},
): ProductDiscoveryProvider {
  return {
    providerCode: "internal_catalog",
    critical: true,
    supportedModes: ["barcode", "name"],
    search: vi.fn(),
    ...patch,
  };
}

