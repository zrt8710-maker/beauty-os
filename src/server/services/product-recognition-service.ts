import "server-only";

import {
  productRecognitionRequestSchema,
  productRecognitionResponseSchema,
  type ProductRecognitionCandidate,
  type ProductRecognitionResponse,
} from "@/schemas/product-recognition";
import type { ProductRecognitionProvider } from "@/server/product-recognition/provider";
import { productIdentityDebug } from "@/server/product-identity/identity-research-debug";

export type ProductRecognitionService = {
  recognize(input: unknown): Promise<ProductRecognitionResponse>;
};

export function createProductRecognitionService(
  providers: ProductRecognitionProvider[],
): ProductRecognitionService {
  return {
    async recognize(input) {
      const startedAt = Date.now();
      const request = productRecognitionRequestSchema.parse(input);
      const candidates: ProductRecognitionCandidate[] = [];

      for (const provider of providers) {
        if (provider.executionPolicy === "on_empty_result" && candidates.length > 0) {
          continue;
        }
        const providerStartedAt = Date.now();
        const discovered = await provider.recognize(request);
        productIdentityDebug("Product Recognition", {
          provider_name: provider.providerCode,
          candidate_count: discovered.length,
          elapsed_ms: Date.now() - providerStartedAt,
        });
        candidates.push(...discovered);
      }

      const confirmableCandidates = candidates
        .filter((candidate) => candidate.confidence >= 60)
        .filter((candidate) => candidate.brand_name !== null && candidate.product_name !== null)
        .slice(0, 20);

      const result = productRecognitionResponseSchema.parse({
        status: confirmableCandidates.length > 0 ? "candidates" : "no_match",
        candidates: confirmableCandidates,
      });
      productIdentityDebug("Product Recognition", {
        provider_name: "orchestration",
        candidate_count: result.candidates.length,
        elapsed_ms: Date.now() - startedAt,
      });
      return result;
    },
  };
}
