import "server-only";

import {
  PRODUCT_DISCOVERY_RESULT_VERSION,
  normalizedProductDiscoveryQuerySchema,
  productDiscoveryProviderResultSchema,
  productDiscoveryRequestSchema,
  productDiscoveryResultSchema,
  type NormalizedProductDiscoveryQuery,
  type ProductDiscoveryIssue,
  type ProductDiscoveryProviderResult,
  type ProductDiscoveryResult,
} from "@/schemas/product-discovery";
import {
  matchProductCandidates,
  normalizeDiscoveryBarcode,
} from "@/server/domain/product-discovery";
import type { ProductDiscoveryProvider } from "@/server/integrations/product-discovery/provider";

export type ProductDiscoveryService = {
  search(input: unknown): Promise<ProductDiscoveryResult>;
};

export class CriticalProductDiscoveryProviderError extends Error {
  readonly code = "PRODUCT_DISCOVERY_PROVIDER_FAILED";

  constructor(public readonly providerCode: string, cause?: unknown) {
    super("PRODUCT_DISCOVERY_PROVIDER_FAILED", { cause });
    this.name = "CriticalProductDiscoveryProviderError";
  }
}

export function createProductDiscoveryService(
  providers: ProductDiscoveryProvider[],
): ProductDiscoveryService {
  return {
    async search(input) {
      const request = productDiscoveryRequestSchema.parse(input);
      const query = normalizeQuery(request);
      const providerResults: ProductDiscoveryProviderResult[] = [];
      const warnings: ProductDiscoveryIssue[] = [];

      for (const provider of providers) {
        if (!provider.supportedModes.includes(query.mode)) continue;
        if (
          provider.executionPolicy === "on_internal_miss"
          && hasInternalExactMatch(query, providerResults)
        ) continue;

        try {
          providerResults.push(productDiscoveryProviderResultSchema.parse(
            await provider.search(query),
          ));
        } catch (error) {
          if (provider.critical) {
            throw new CriticalProductDiscoveryProviderError(
              provider.providerCode,
              error,
            );
          }

          const issue = {
            code: "PRODUCT_DISCOVERY_PROVIDER_UNAVAILABLE",
            message: `${provider.providerCode} 暂时不可用。`,
            fields: [],
          };
          warnings.push(issue);
          providerResults.push({
            provider_code: provider.providerCode,
            status: "failed",
            candidates: [],
            issues: [issue],
          });
        }
      }

      const match = matchProductCandidates(
        query,
        providerResults.flatMap((result) => result.candidates),
      );

      return productDiscoveryResultSchema.parse({
        result_version: PRODUCT_DISCOVERY_RESULT_VERSION,
        query,
        status: match.status,
        candidates: match.candidates,
        provider_results: providerResults,
        warnings: [...warnings, ...match.warnings],
      });
    },
  };
}

function hasInternalExactMatch(
  query: NormalizedProductDiscoveryQuery,
  providerResults: ProductDiscoveryProviderResult[],
) {
  if (query.mode !== "barcode") return false;
  return providerResults.some((result) => result.candidates.some((candidate) =>
    candidate.candidate_kind === "internal_verified"
    && candidate.existing_catalog_product_id !== null
    && candidate.barcode === query.barcode
  ));
}

function normalizeQuery(
  request: ReturnType<typeof productDiscoveryRequestSchema.parse>,
): NormalizedProductDiscoveryQuery {
  return normalizedProductDiscoveryQuerySchema.parse(
    request.mode === "barcode"
      ? { ...request, barcode: normalizeDiscoveryBarcode(request.barcode) }
      : request,
  );
}
