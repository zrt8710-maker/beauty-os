import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { parse } from "yaml";

export const ingredientKnowledgePackEntrySchema = z.object({
  canonical_name: z.string().trim().min(1).max(200),
  display_name_zh: z.string().trim().min(1).max(200),
  functions: z.array(z.string().trim().min(1).max(160)).max(6),
  statement_zh: z.string().trim().min(1).max(600),
  use_for_today_explanation: z.array(z.string().trim().min(1).max(400)).max(6).default([]),
  boundary: z.array(z.string().trim().min(1).max(400)).max(6).default([]),
  confidence: z.number().finite().min(0).max(100).optional(),
  sources: z.array(z.string().trim().url().max(1000)).max(12).default([]),
  aliases_zh: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
}).strict();

const packSchema = z.object({
  version: z.literal(1),
  scope: z.string().trim().min(1).max(500).optional(),
  principles: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
  ingredients: z.array(ingredientKnowledgePackEntrySchema).max(500),
}).strict();

export type IngredientKnowledgePackEntry = z.infer<typeof ingredientKnowledgePackEntrySchema>;

export type IngredientKnowledgePack = {
  /** Returns facts only for ingredient names actually supplied by this product. */
  findForIngredientNames(names: readonly string[], limit?: number): Promise<IngredientKnowledgePackEntry[]>;
};

/** V1 keeps its source of truth in a structured, document-backed YAML Pack. */
export function createIngredientKnowledgePack(options: { packPath?: string } = {}): IngredientKnowledgePack {
  const readPack = options.packPath
    ? () => readFile(/* turbopackIgnore: true */ options.packPath!, "utf8")
    : () => readFile(
        path.join(process.cwd(), "docs", "ingredient-knowledge", "INGREDIENT_KNOWLEDGE_PACK_V1.yaml"),
        "utf8",
      );
  let parsedPackPromise: Promise<z.infer<typeof packSchema>> | null = null;
  const loadPack = () => {
    parsedPackPromise ??= readPack()
      .then((content) => packSchema.parse(parse(content)));
    return parsedPackPromise;
  };
  return {
    async findForIngredientNames(names, limit = 5) {
      const knownNames = new Set(names.map(canonicalizeIngredientName).filter(Boolean));
      if (knownNames.size === 0) return [];
      const parsed = await loadPack();
      return parsed.ingredients
        .filter((entry) => ingredientKnowledgeEntryMatchesNames(entry, knownNames))
        .slice(0, Math.min(Math.max(limit, 0), 500));
    },
  };
}

const CANONICAL_INGREDIENT_ALIASES: Readonly<Record<string, string>> = {
  "colloidal sulfur": "sulfur",
  "simmondsia chinensis seed oil": "simmondsia chinensis (jojoba) seed oil",
  "扁桃酸": "mandelic acid",
};

/** Explicit ingredient-name compatibility only; never a fuzzy match. */
export function canonicalizeIngredientName(value: string) {
  const normalized = normalizeIngredientName(value);
  return CANONICAL_INGREDIENT_ALIASES[normalized] ?? normalized;
}

/**
 * Matches only names explicitly supplied by the Pack (canonical, Chinese
 * display, aliases_zh) or the one-to-one compatibility table above.
 */
export function ingredientKnowledgeEntryMatchesNames(
  entry: IngredientKnowledgePackEntry,
  names: ReadonlySet<string>,
) {
  const entryNames = [
    entry.canonical_name,
    entry.display_name_zh,
    ...(entry.aliases_zh ?? []),
  ].map(canonicalizeIngredientName);
  return entryNames.some((name) => names.has(name));
}

function normalizeIngredientName(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}
