import "server-only";

import { createMockProductRecognitionProvider } from "./mock-product-recognition-provider";
import { createConfiguredBailianProductRecognitionProvider } from "./providers/bailian-product-recognition-provider";
import {
  createProductRecognitionService,
  type ProductRecognitionService,
} from "@/server/services/product-recognition-service";

export async function createRequestProductRecognitionService(): Promise<
  ProductRecognitionService
> {
  const providers = [
    createConfiguredBailianProductRecognitionProvider(),
    createMockProductRecognitionProvider(),
  ].filter((provider): provider is NonNullable<typeof provider> => provider !== null);
  return createProductRecognitionService(providers);
}
