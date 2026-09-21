import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Product Identity Resolution integration boundary", () => {
  it("routes Recognition confirmation through Identity Resolution before asset creation", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/features/inventory/inventory-manager.tsx"),
      "utf8",
    );

    expect(source).toContain('"/api/v1/product-identity/resolve"');
    expect(source).toContain("await resolveRecognitionCandidate(recognitionCandidate)");
    expect(source).toContain("catalogIdentityToLookupCandidate");
    expect(source).toContain("externalIdentityToLookupCandidate");
    expect(source).toContain('recognitionCandidates !== null ? "用此线索查找产品" : "就是这个"');
    expect(source).toContain('"保存并加入资产"');
    expect(source).not.toContain("issueRecognitionConfirmationToken(user.id, candidate)");
  });

  it("routes image and manual inputs through the same Identity Clue resolver", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/features/inventory/inventory-manager.tsx"),
      "utf8",
    );

    expect(source).toContain("recognitionCandidateToIdentityClue");
    expect(source).toContain("manualSearchToIdentityClue");
    expect(source).toContain("resolveIdentityClue(");
    expect(source).not.toContain('"/api/v1/manual-product-search"');
  });

  it("keeps the Identity API read-only with respect to assets, Knowledge, and rule decisions", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/api/v1/product-identity/resolve/route.ts"),
      "utf8",
    );

    expect(source).not.toContain("createOwnedProductWithIdentity");
    expect(source).not.toContain("owned-products");
    expect(source).not.toContain("knowledge-repository");
    expect(source).not.toContain("rule-engine");
    expect(source).not.toContain("resolver");
  });

  it("uses a Recognition reference for resolution and only issues an external confirmation after resolution", async () => {
    const [recognitionRoute, resolutionRoute] = await Promise.all([
      readFile(path.join(process.cwd(), "src/app/api/v1/product-recognition/route.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/app/api/v1/product-identity/resolve/route.ts"), "utf8"),
    ]);

    expect(recognitionRoute).toContain("issueRecognitionReference");
    expect(recognitionRoute).not.toContain("issueRecognitionConfirmationToken");
    expect(resolutionRoute).toContain("verifyRecognitionReference");
    expect(resolutionRoute).toContain("issueRecognitionConfirmationToken");
  });
});
