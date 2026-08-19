import "server-only";

import {
  PRODUCT_TYPE_META,
  ownedProductCreateSchema,
  ownedProductIdSchema,
  ownedProductListQuerySchema,
  ownedProductSchema,
  ownedProductStateSchema,
  ownedProductUpdateSchema,
  productCreateSchema,
  productListQuerySchema,
  productSchema,
  type OwnedProduct,
  type OwnedProductUpdateInput,
  type Product,
} from "@/schemas/product";
import type {
  OwnedProductRepository,
  OwnedProductWithProductRow,
} from "@/server/repositories/owned-product-repository";
import type {
  ProductRepository,
  ProductRow,
} from "@/server/repositories/product-repository";

export class InventoryNotFoundError extends Error {
  constructor(public readonly code: "PRODUCT_NOT_FOUND" | "OWNED_PRODUCT_NOT_FOUND") {
    super(code);
    this.name = "InventoryNotFoundError";
  }
}

function toProduct(row: ProductRow): Product {
  return productSchema.parse({
    id: row.id,
    brand_name: row.brand_name,
    product_name: row.product_name,
    category: row.category,
    subcategory: row.subcategory,
    product_type: row.product_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function toOwnedProduct(row: OwnedProductWithProductRow): OwnedProduct {
  return ownedProductSchema.parse({
    id: row.id,
    product_id: row.product_id,
    status: row.status,
    purchase_date: row.purchase_date,
    opened_at: row.opened_at,
    expires_on: row.expires_on,
    quantity_remaining_percent: row.quantity_remaining_percent,
    notes: row.notes,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    product: toProduct(row.product),
  });
}

function toOwnedProductUpdate(
  input: OwnedProductUpdateInput,
  updatedAt: string,
) {
  return {
    ...input,
    updated_at: updatedAt,
  };
}

export type InventoryService = {
  listProducts(userId: string, query: unknown): Promise<Product[]>;
  createProduct(userId: string, input: unknown): Promise<Product>;
  listOwnedProducts(userId: string, query: unknown): Promise<OwnedProduct[]>;
  createOwnedProduct(userId: string, input: unknown): Promise<OwnedProduct>;
  updateOwnedProduct(
    userId: string,
    ownedProductId: unknown,
    input: unknown,
  ): Promise<OwnedProduct>;
  archiveOwnedProduct(
    userId: string,
    ownedProductId: unknown,
  ): Promise<OwnedProduct>;
};

export function createInventoryService(
  products: ProductRepository,
  ownedProducts: OwnedProductRepository,
): InventoryService {
  return {
    async listProducts(userId, query) {
      const validated = productListQuerySchema.parse(query);
      const rows = await products.listByUserId(userId, validated);
      return rows.map(toProduct);
    },

    async createProduct(userId, input) {
      const validated = productCreateSchema.parse(input);
      const metadata = PRODUCT_TYPE_META[validated.product_type];
      const row = await products.create(userId, {
        ...validated,
        subcategory: metadata.subcategory,
        updated_at: new Date().toISOString(),
      });
      return toProduct(row);
    },

    async listOwnedProducts(userId, query) {
      const validated = ownedProductListQuerySchema.parse(query);
      const rows = await ownedProducts.listByUserId(userId, validated);
      return rows.map(toOwnedProduct);
    },

    async createOwnedProduct(userId, input) {
      const validated = ownedProductCreateSchema.parse(input);
      const product = await products.findById(userId, validated.product_id);

      if (!product) {
        throw new InventoryNotFoundError("PRODUCT_NOT_FOUND");
      }

      const row = await ownedProducts.create(userId, validated);
      return toOwnedProduct(row);
    },

    async updateOwnedProduct(userId, ownedProductId, input) {
      const validatedId = ownedProductIdSchema.parse(ownedProductId);
      const validatedUpdate = ownedProductUpdateSchema.parse(input);
      const existing = await ownedProducts.findById(userId, validatedId);

      if (!existing) {
        throw new InventoryNotFoundError("OWNED_PRODUCT_NOT_FOUND");
      }

      const currentState = ownedProductStateSchema.parse({
        product_id: existing.product_id,
        status: existing.status,
        purchase_date: existing.purchase_date,
        opened_at: existing.opened_at,
        expires_on: existing.expires_on,
        quantity_remaining_percent: existing.quantity_remaining_percent,
        notes: existing.notes,
      });

      ownedProductStateSchema.parse({ ...currentState, ...validatedUpdate });

      const row = await ownedProducts.update(
        userId,
        validatedId,
        toOwnedProductUpdate(validatedUpdate, new Date().toISOString()),
      );

      if (!row) {
        throw new InventoryNotFoundError("OWNED_PRODUCT_NOT_FOUND");
      }

      return toOwnedProduct(row);
    },

    async archiveOwnedProduct(userId, ownedProductId) {
      const validatedId = ownedProductIdSchema.parse(ownedProductId);
      const row = await ownedProducts.archive(
        userId,
        validatedId,
        new Date().toISOString(),
      );

      if (!row) {
        throw new InventoryNotFoundError("OWNED_PRODUCT_NOT_FOUND");
      }

      return toOwnedProduct(row);
    },
  };
}
