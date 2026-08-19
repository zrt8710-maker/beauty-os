import "server-only";

import { catalogProductIdSchema, catalogProductIngredientSchema, catalogProductListQuerySchema, catalogProductSchema, type CatalogProduct, type CatalogProductIngredient } from "@/schemas/knowledge";
import type { CatalogProductIngredientWithRelationsRow, CatalogProductWithSourceRow, KnowledgeRepository } from "@/server/repositories/knowledge-repository";

export class KnowledgeProductNotFoundError extends Error { constructor() { super("KNOWLEDGE_PRODUCT_NOT_FOUND"); this.name = "KnowledgeProductNotFoundError"; } }

function source(row: CatalogProductWithSourceRow["source"]) { return { id: row.id, source_type: row.source_type, name: row.name, source_url: row.source_url, license_note: row.license_note, retrieved_at: row.retrieved_at }; }
function product(row: CatalogProductWithSourceRow): CatalogProduct { return catalogProductSchema.parse({ ...row, status: "verified", source: source(row.source) }); }
function ingredient(row: CatalogProductIngredientWithRelationsRow): CatalogProductIngredient { return catalogProductIngredientSchema.parse({ ingredient_order: row.ingredient_order, confidence: row.confidence, evidence_note: row.evidence_note, ingredient: row.ingredient, source: source(row.source) }); }

export type KnowledgeService = { listProducts(query: unknown): Promise<CatalogProduct[]>; getProductIngredients(productId: unknown): Promise<{ product: CatalogProduct; ingredients: CatalogProductIngredient[] }>; };
export function createKnowledgeService(repository: KnowledgeRepository): KnowledgeService {
  return {
    async listProducts(query) { return (await repository.listVerifiedProducts(catalogProductListQuerySchema.parse(query))).map(product); },
    async getProductIngredients(productId) { const id = catalogProductIdSchema.parse(productId); const found = await repository.findVerifiedProduct(id); if (!found) throw new KnowledgeProductNotFoundError(); return { product: product(found), ingredients: (await repository.listVerifiedProductIngredients(id)).map(ingredient) }; },
  };
}
