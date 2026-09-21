import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Product Recognition Boundary v0.3", () => {
  it("keeps inferred fields out of the public candidate schema", async () => {
    const source = await read("src/schemas/product-recognition.ts");
    const contract = source.slice(source.indexOf("productRecognitionCandidateSchema"), source.indexOf("productRecognitionResponseSchema"));
    expect(contract).toContain("brand_name");
    expect(contract).toContain("product_name");
    expect(contract).toContain("observed_text");
    expect(contract).not.toContain("variant_name");
    expect(contract).not.toContain("product_type");
    expect(contract).not.toContain("marketing_claim");
  });

  it("hides technical identity fields on Recognition confirmation cards", async () => {
    const source = await read("src/features/inventory/inventory-manager.tsx");
    expect(source).toContain("observationOnly={recognitionCandidates !== null}");
    expect(source).toContain("!observationOnly && candidate.candidate_kind === \"external\"");
    expect(source).toContain("用此线索查找产品");
  });

  it("does not connect Recognition to assets, Knowledge, Resolver, or Rule Engine", async () => {
    const source = (await Promise.all([
      "src/server/services/product-recognition-service.ts",
      "src/server/product-recognition/providers/bailian-product-recognition-provider.ts",
      "src/app/api/v1/product-recognition/route.ts",
    ].map(read))).join("\n").toLowerCase();
    expect(source).not.toContain("createownedproduct");
    expect(source).not.toContain("knowledge-repository");
    expect(source).not.toContain("rule-engine");
    expect(source).not.toContain("product-decision-resolver");
    expect(source).not.toContain("package_size:");
    expect(source).not.toContain("manufacture_date");
  });
});

function read(file: string) { return readFile(path.join(process.cwd(), file), "utf8"); }
