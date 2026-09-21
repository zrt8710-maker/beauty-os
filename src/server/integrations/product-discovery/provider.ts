import type {
  NormalizedProductDiscoveryQuery,
  ProductDiscoveryProviderResult,
} from "@/schemas/product-discovery";

export type ProductDiscoveryProvider = {
  readonly providerCode: string;
  readonly critical: boolean;
  readonly executionPolicy?: "always" | "on_internal_miss";
  readonly supportedModes: ReadonlyArray<"barcode" | "name">;
  search(
    query: NormalizedProductDiscoveryQuery,
  ): Promise<ProductDiscoveryProviderResult>;
};
