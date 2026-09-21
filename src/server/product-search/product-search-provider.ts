import type { ProductSearchInput, ProductSearchResult } from "@/schemas/product-search";

export interface ProductSearchProvider {
  readonly providerCode: string;
  search(input: ProductSearchInput): Promise<ProductSearchResult[]>;
}
