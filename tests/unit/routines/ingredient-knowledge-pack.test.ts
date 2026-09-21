import path from "node:path";

import { describe, expect, it } from "vitest";

import { createIngredientKnowledgePack } from "@/server/services/ingredient-knowledge-pack";

const fixturePath = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "ingredient-knowledge-pack-v1.yaml",
);

describe("Document-backed Ingredient Knowledge Pack", () => {
  it("loads all 19 checked-in V1 Pack entries without a database read", async () => {
    const pack = createIngredientKnowledgePack();
    await expect(pack.findForIngredientNames([
      "Niacinamide", "Glycerin", "Sodium Hyaluronate", "Hydrolyzed Hyaluronic Acid", "Panthenol",
      "Ceramide NP", "Ceramide AP", "Ceramide NS", "Squalane", "Dipotassium Glycyrrhizate",
      "Madecassoside", "Allantoin", "Sulfur", "Lactobionic Acid", "Gluconolactone", "Mandelic Acid",
      "Simmondsia Chinensis (Jojoba) Seed Oil", "Decyl Glucoside", "Acetyl Glucosamine",
    ], 19)).resolves.toHaveLength(19);
  });

  it("returns only Pack facts whose canonical ingredient is actually in the product", async () => {
    const pack = createIngredientKnowledgePack({ packPath: fixturePath });

    await expect(pack.findForIngredientNames([
      "Niacinamide",
      "Water",
      "Unlisted Ingredient",
    ])).resolves.toEqual([expect.objectContaining({
      canonical_name: "Niacinamide",
      display_name_zh: "烟酰胺",
      statement_zh: expect.any(String),
      boundary: expect.any(Array),
    })]);
  });

  it("supports the canonical names expected from Simcare, Yasoo, and HFP research drafts", async () => {
    const pack = createIngredientKnowledgePack({ packPath: fixturePath });

    await expect(pack.findForIngredientNames([
      "Niacinamide",
      "Colloidal Sulfur",
      "Mandelic Acid",
    ])).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical_name: "Sulfur" }),
    ]));
  });

  it("matches the exact ingredient spellings present in the verified product drafts", async () => {
    const pack = createIngredientKnowledgePack();
    await expect(pack.findForIngredientNames([
      "Niacinamide", "Sodium Hyaluronate", "Madecassoside", "Ceramide NP", "Ceramide AP",
      "Glycerin", "Squalane", "Simmondsia Chinensis Seed Oil",
      "胶态硫", "尿囊素", "甘草酸二钾",
      "乳糖酸", "葡糖酸内酯", "扁桃酸",
    ], 20)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical_name: "Niacinamide" }),
      expect.objectContaining({ canonical_name: "Sodium Hyaluronate" }),
      expect.objectContaining({ canonical_name: "Madecassoside" }),
      expect.objectContaining({ canonical_name: "Ceramide NP" }),
      expect.objectContaining({ canonical_name: "Ceramide AP" }),
      expect.objectContaining({ canonical_name: "Simmondsia Chinensis (Jojoba) Seed Oil" }),
      expect.objectContaining({ canonical_name: "Sulfur" }),
      expect.objectContaining({ canonical_name: "Allantoin" }),
      expect.objectContaining({ canonical_name: "Dipotassium Glycyrrhizate" }),
      expect.objectContaining({ canonical_name: "Lactobionic Acid" }),
      expect.objectContaining({ canonical_name: "Gluconolactone" }),
      expect.objectContaining({ canonical_name: "Mandelic Acid" }),
    ]));
  });
});
