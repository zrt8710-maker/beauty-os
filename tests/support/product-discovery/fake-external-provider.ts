import {
  productDiscoveryProviderResultSchema,
  type NormalizedProductDiscoveryQuery,
  type ProductDiscoveryCandidate,
} from "@/schemas/product-discovery";
import type { ProductDiscoveryProvider } from "@/server/integrations/product-discovery/provider";

type FakeExternalProviderOptions = {
  providerCode?: string;
  candidates?: ProductDiscoveryCandidate[];
  error?: Error;
  supportedModes?: ReadonlyArray<"barcode" | "name">;
};

export type FakeExternalProvider = ProductDiscoveryProvider & {
  readonly calls: NormalizedProductDiscoveryQuery[];
};

export function createFakeExternalProvider(
  options: FakeExternalProviderOptions = {},
): FakeExternalProvider {
  const providerCode = options.providerCode ?? "fake_external";
  const calls: NormalizedProductDiscoveryQuery[] = [];

  return {
    providerCode,
    critical: false,
    supportedModes: options.supportedModes ?? ["barcode", "name"],
    calls,
    async search(query) {
      calls.push(query);
      if (options.error) throw options.error;

      const candidates = options.candidates ?? [];
      return productDiscoveryProviderResultSchema.parse({
        provider_code: providerCode,
        status: candidates.length > 0 ? "ok" : "not_found",
        candidates,
        issues: [],
      });
    },
  };
}
