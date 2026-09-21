import { describe, expect, it } from "vitest";
import { productRecognitionCandidateSchema } from "@/schemas/product-recognition";
import { createMockProductRecognitionProvider } from "@/server/product-recognition/mock-product-recognition-provider";
import { createProductRecognitionService } from "@/server/services/product-recognition-service";

describe("Product Recognition visual boundary", () => {
  it("returns only observed brand and product-name text", async () => {
    const service = createProductRecognitionService([createMockProductRecognitionProvider()]);
    const result = await service.recognize({ mode: "natural_language", brand_name: "ONCUR", product_name: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE" });
    expect(result).toEqual({ status: "candidates", candidates: [expect.objectContaining({
      brand_name: "ONCUR", product_name: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE",
      observed_text: [{ value: "ONCUR", type: "brand" }, { value: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE", type: "product_name" }],
    })] });
  });

  it("strictly rejects legacy inferred identity fields", () => {
    const parsed = productRecognitionCandidateSchema.safeParse({
      brand_name: "ONCUR", product_name: "Essence", confidence: 95, observed_text: [], recognition_reference: null,
      product_type: "essence", variant_name: "50ml", marketing_claim: "repair",
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps low-confidence observations out of confirmation", async () => {
    const service = createProductRecognitionService([{ providerCode: "low", executionPolicy: "always", recognize: async () => [{ brand_name: "X", product_name: "Y", confidence: 59, observed_text: [], recognition_reference: null }] }]);
    await expect(service.recognize({ mode: "natural_language", brand_name: "X", product_name: "Y" })).resolves.toEqual({ status: "no_match", candidates: [] });
  });
});
