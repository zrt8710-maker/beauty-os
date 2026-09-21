import "server-only";

import { createRequestProductDiscoveryService } from "@/server/product-discovery/product-discovery-composition";
import type { ProductDiscoveryService } from "@/server/services/product-discovery-service";

export async function createAdminProductDiscoveryService(): Promise<
  ProductDiscoveryService
> {
  return createRequestProductDiscoveryService();
}
