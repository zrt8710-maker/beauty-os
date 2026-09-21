import "server-only";

import type { ProductRecognitionProvider } from "./provider";

export function createMockProductRecognitionProvider(): ProductRecognitionProvider {
  return {
    providerCode: "mock_product_recognition",
    executionPolicy: "on_empty_result",
    async recognize(input) {
      if (input.mode === "image") return [];
      return [{
        brand_name: input.brand_name,
        product_name: input.product_name,
        confidence: 100,
        observed_text: [
          ...(input.brand_name ? [{ value: input.brand_name, type: "brand" as const }] : []),
          { value: input.product_name, type: "product_name" as const },
        ],
        recognition_reference: null,
      }];
    },
  };
}
