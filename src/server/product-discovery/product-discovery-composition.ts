import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createInternalCatalogProvider } from "@/server/integrations/product-discovery/internal-catalog-provider";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import {
  createProductDiscoveryService,
  type ProductDiscoveryService,
} from "@/server/services/product-discovery-service";

export async function createRequestProductDiscoveryService(): Promise<
  ProductDiscoveryService
> {
  const repository = createKnowledgeRepository(await createClient());
  return createProductDiscoveryService([
    createInternalCatalogProvider(repository),
  ]);
}
