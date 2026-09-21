import type {
  ProductRecognitionCandidate,
  ProductRecognitionRequest,
} from "@/schemas/product-recognition";

/**
 * Provider contract for visual/text observation. Providers return visible
 * labels only; identity resolution and product knowledge are separate layers.
 */
export type ProductRecognitionProvider = {
  readonly providerCode: string;
  readonly executionPolicy: "always" | "on_empty_result";
  recognize(
    input: ProductRecognitionRequest,
  ): Promise<ProductRecognitionCandidate[]>;
};

export type AiProductRecognitionProvider = ProductRecognitionProvider;
