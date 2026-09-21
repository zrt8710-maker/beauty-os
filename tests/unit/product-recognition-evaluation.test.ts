import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Recognition boundary isolation", () => {
  it("does not call assets, Knowledge, Resolver, or Rule Engine", async () => {
    const files = await Promise.all([
      "src/server/services/product-recognition-service.ts",
      "src/server/product-recognition/providers/bailian-product-recognition-provider.ts",
      "src/app/api/v1/product-recognition/route.ts",
    ].map((file) => readFile(path.join(process.cwd(), file), "utf8")));
    const source = files.join("\n").toLowerCase();
    expect(source).not.toContain("owned-products");
    expect(source).not.toContain("knowledge");
    expect(source).not.toContain("rule-engine");
    expect(source).not.toContain("product-decision-resolver");
  });
});
