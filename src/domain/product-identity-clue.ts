import {
  productIdentityClueSchema,
  type ProductIdentityClue,
} from "@/schemas/product-identity-clue";
import type { ProductRecognitionCandidate } from "@/schemas/product-recognition";

export function recognitionCandidateToIdentityClue(
  candidate: ProductRecognitionCandidate,
): ProductIdentityClue {
  return productIdentityClueSchema.parse({
    source: "image_recognition",
    raw_query: null,
    brand_name: candidate.brand_name,
    product_name: candidate.product_name,
    recognition_confidence: candidate.confidence,
    observed_text: candidate.observed_text,
  });
}

export function manualSearchToIdentityClue(input: {
  query: string;
  brand_name?: string | null;
}): ProductIdentityClue {
  const query = input.query.trim();
  return productIdentityClueSchema.parse({
    source: "manual_search",
    raw_query: query,
    brand_name: input.brand_name?.trim() || null,
    product_name: query || null,
    recognition_confidence: null,
    observed_text: [],
  });
}
