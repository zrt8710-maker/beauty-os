import "server-only";

import {
  resolveProductDecisionProfile,
  type ProductDecisionProduct,
  type ProductDecisionProfile,
  type ProductDecisionSafetySignals,
} from "@/server/domain/product-decision";
import type { ProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";
import type { RuntimeAvailableProductKnowledge } from "@/server/services/product-knowledge-runtime-availability-service";

export type ProductDecisionResolverService = {
  resolve(
    product: ProductDecisionProduct,
    safetySignals?: ProductDecisionSafetySignals,
  ): Promise<ProductDecisionProfile>;
  resolveMany(
    products: ProductDecisionProduct[],
    safetySignalsByProductId?: ReadonlyMap<
      string,
      ProductDecisionSafetySignals
    >,
  ): Promise<ProductDecisionProfile[]>;
};

export function createProductDecisionResolverService(
  knowledgeRepository?: Pick<ProductKnowledgeRepository, "findByCatalogProductId"> | { findByCatalogProductId(catalogProductId: string): Promise<RuntimeAvailableProductKnowledge> },
): ProductDecisionResolverService {
  async function resolve(
    product: ProductDecisionProduct,
    safetySignals?: ProductDecisionSafetySignals,
  ) {
    let knowledge = null;

    if (product.catalog_product_id && knowledgeRepository) {
      try {
        knowledge = await knowledgeRepository.findByCatalogProductId(
          product.catalog_product_id,
        );
      } catch {
        // Knowledge enrichment is optional. Its failure must not block a
        // user-owned product from receiving a fallback decision profile.
      }
    }

    return resolveProductDecisionProfile({
      product,
      knowledge,
      safetySignals,
    });
  }

  return {
    resolve,
    async resolveMany(products, safetySignalsByProductId) {
      return Promise.all(products.map((product) =>
        resolve(product, safetySignalsByProductId?.get(product.id))));
    },
  };
}
