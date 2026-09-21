import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 1 runtime isolation", () => {
  it("keeps runtime knowledge repositories verified-only", async () => {
    const [knowledge, productKnowledge, routineContext, overview] = await Promise.all([
      source("src/server/repositories/knowledge-repository.ts"),
      source("src/server/repositories/product-knowledge-repository.ts"),
      source("src/server/routines/get-routine-request-context.ts"),
      source("src/server/services/admin-product-knowledge-overview-service.ts"),
    ]);

    expect(knowledge).toContain('.eq("status", "verified")');
    expect(productKnowledge).toContain('.eq("status", "verified")');
    expect(routineContext).toContain("createProductKnowledgeRepository");
    expect(overview).not.toContain("ProductKnowledgeRepository");
    expect(overview).not.toContain("RuleEngine");
  });
});

function source(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}
