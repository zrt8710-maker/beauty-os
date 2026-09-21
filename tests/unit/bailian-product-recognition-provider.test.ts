import { describe, expect, it, vi } from "vitest";

import { createBailianProductRecognitionProvider } from "@/server/product-recognition/providers/bailian-product-recognition-provider";

describe("Bailian visual observation provider", () => {
  it("returns only observed brand, product name, and packaging text", async () => {
    const provider = providerWith({ candidates: [{
      brand_name: "ONCUR",
      product_name: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE",
      confidence: 0.98,
      product_type: "essence",
      variant_name: "50ml version",
      ingredients: ["PDRN"],
      observed_text: [
        { value: "ONCUR", type: "brand" },
        { value: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE", type: "product_name" },
        { value: "50ml", type: "package_size" },
        { value: "OLEACALM + PDRN", type: "marketing_text" },
      ],
    }] });

    const result = await provider.recognize(imageInput());
    expect(result).toEqual([{
      brand_name: "ONCUR",
      product_name: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE",
      confidence: 98,
      observed_text: expect.arrayContaining([
        { value: "50ml", type: "package_size" },
        { value: "OLEACALM + PDRN", type: "marketing_text" },
      ]),
      recognition_reference: null,
    }]);
    expect(result[0]).not.toHaveProperty("product_type");
    expect(result[0]).not.toHaveProperty("variant_name");
    expect(result[0]).not.toHaveProperty("ingredients");
    expect(result[0]).not.toHaveProperty("marketing_claim");
  });

  it("normalizes field aliases and Markdown JSON", async () => {
    const provider = providerWithContent("```json\n{\"brand\":\"HFP\",\"name\":\"果酸精粹水\",\"confidence\":88}\n```");
    await expect(provider.recognize(nameInput())).resolves.toEqual([
      expect.objectContaining({ brand_name: "HFP", product_name: "果酸精粹水", confidence: 88 }),
    ]);
  });

  it("does not invent fields when they are absent", async () => {
    const provider = providerWith({ candidates: [{ brand_name: null, product_name: null, confidence: 70, observed_text: [] }] });
    await expect(provider.recognize(imageInput())).resolves.toEqual([
      { brand_name: null, product_name: null, confidence: 70, observed_text: [], recognition_reference: null },
    ]);
  });

  it("returns no observation on HTTP or invalid JSON failure", async () => {
    const http = createBailianProductRecognitionProvider({ apiKey: "x", model: "m", fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 500 })) });
    const json = providerWithContent("not-json");
    await expect(http.recognize(nameInput())).resolves.toEqual([]);
    await expect(json.recognize(nameInput())).resolves.toEqual([]);
  });

  it("prompt explicitly prohibits product attributes and identity inference", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(completion({ candidates: [] }));
    const provider = createBailianProductRecognitionProvider({ apiKey: "x", model: "m", fetchImpl });
    await provider.recognize(imageInput());
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content).toContain("禁止推断产品类型");
    expect(body.messages[0].content).toContain("真实商品身份");
  });
});

function providerWith(value: unknown) { return providerWithContent(JSON.stringify(value)); }
function providerWithContent(content: string) {
  return createBailianProductRecognitionProvider({
    apiKey: "x", model: "m",
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(completionContent(content)),
  });
}
function completion(value: unknown) { return completionContent(JSON.stringify(value)); }
function completionContent(content: string) { return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }); }
function imageInput() { return { mode: "image" as const, images: [{ position: "front" as const, data_url: "data:image/png;base64,AAAAAAAAAAAAAAAA" }] }; }
function nameInput() { return { mode: "natural_language" as const, brand_name: "HFP", product_name: "果酸精粹水" }; }
