import "server-only";

import {
  uploadAssetSchema,
  uploadCreateSchema,
  uploadIdSchema,
  uploadListQuerySchema,
  uploadTaskSchema,
  type UploadAsset,
  type UploadTask,
} from "@/schemas/upload";
import type { ProductImageStorage } from "@/server/integrations/storage/product-images";
import type {
  UploadAssetRow,
  UploadRepository,
} from "@/server/repositories/upload-repository";
import type { ProductRepository } from "@/server/repositories/product-repository";
import type { OwnedProductRepository } from "@/server/repositories/owned-product-repository";
import type { OwnedProduct } from "@/schemas/product";

const extensionByMimeType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export class UploadNotFoundError extends Error {
  constructor(public readonly code: "PRODUCT_NOT_FOUND" | "UPLOAD_NOT_FOUND") {
    super(code);
    this.name = "UploadNotFoundError";
  }
}

export class UploadStateError extends Error {
  constructor(
    public readonly code:
      | "UPLOAD_INCOMPLETE"
      | "UPLOAD_FAILED"
      | "UPLOAD_METADATA_MISMATCH",
  ) {
    super(code);
    this.name = "UploadStateError";
  }
}

function toUploadAsset(
  row: UploadAssetRow,
  signedUrl: string | null,
): UploadAsset {
  return uploadAssetSchema.parse({
    id: row.id,
    product_id: row.product_id,
    owned_product_id: row.owned_product_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    file_size: row.file_size,
    purpose: row.purpose,
    status: row.status,
    created_at: row.created_at,
    signed_url: signedUrl,
  });
}

async function toReadableUploadAsset(
  row: UploadAssetRow,
  storage: ProductImageStorage,
) {
  const signedUrl =
    row.status === "ready"
      ? await storage.createSignedDownload(row.storage_path)
      : null;
  return toUploadAsset(row, signedUrl);
}

export type UploadService = {
  listUploads(userId: string, query: unknown): Promise<UploadAsset[]>;
  createUploadTask(userId: string, input: unknown): Promise<UploadTask>;
  completeUpload(userId: string, uploadId: unknown): Promise<UploadAsset>;
  deleteUpload(userId: string, uploadId: unknown): Promise<void>;
};

/** Resolves only already-authorized signed URLs; storage paths never leave the server. */
export function resolveOwnedProductImage(ownedProduct: OwnedProduct, uploads: UploadAsset[]): OwnedProduct {
  const override = ownedProduct.image_override_upload_id
    ? uploads.find((upload) => upload.id === ownedProduct.image_override_upload_id && upload.status === "ready" && upload.signed_url)
    : undefined;
  if (override?.signed_url) {
    return { ...ownedProduct, image: { resolved_url: override.signed_url, source: "user_override", has_override: true } };
  }
  const hasBrokenOverride = ownedProduct.image_override_upload_id != null;
  if (ownedProduct.product.catalog_image_url) {
    return { ...ownedProduct, image: { resolved_url: ownedProduct.product.catalog_image_url, source: "catalog", has_override: hasBrokenOverride } };
  }
  if (ownedProduct.identified_image_url) {
    return { ...ownedProduct, image: { resolved_url: ownedProduct.identified_image_url, source: "identified", has_override: hasBrokenOverride } };
  }
  const legacy = uploads.find((upload) => upload.product_id === ownedProduct.product_id && upload.owned_product_id === null && upload.status === "ready" && upload.signed_url);
  if (legacy?.signed_url) {
    return { ...ownedProduct, image: { resolved_url: legacy.signed_url, source: "legacy", has_override: hasBrokenOverride } };
  }
  return {
    ...ownedProduct,
    image: { resolved_url: null, source: "none", has_override: hasBrokenOverride },
  };
}

export function createUploadService(
  uploads: UploadRepository,
  products: ProductRepository,
  storage: ProductImageStorage,
  ownedProducts?: OwnedProductRepository,
): UploadService {
  return {
    async listUploads(userId, query) {
      const validated = uploadListQuerySchema.parse(query);
      const rows = await uploads.listByUserId(userId, validated);
      return Promise.all(
        rows.map((row) => toReadableUploadAsset(row, storage)),
      );
    },

    async createUploadTask(userId, input) {
      const validated = uploadCreateSchema.parse(input);

      const product = validated.product_id
        ? await products.findById(userId, validated.product_id)
        : null;
      const ownedProduct = validated.owned_product_id && ownedProducts
        ? await ownedProducts.findById(userId, validated.owned_product_id)
        : null;

      if (validated.product_id && !product) {
        throw new UploadNotFoundError("PRODUCT_NOT_FOUND");
      }
      if (validated.owned_product_id && !ownedProduct) {
        throw new UploadNotFoundError("PRODUCT_NOT_FOUND");
      }

      const id = crypto.randomUUID();
      const extension = extensionByMimeType[validated.mime_type];
      const storagePath = `${userId}/${id}/original.${extension}`;
      const row = await uploads.create(userId, {
        id,
        product_id: validated.product_id,
        owned_product_id: validated.owned_product_id,
        storage_path: storagePath,
        file_name: validated.file_name,
        mime_type: validated.mime_type,
        file_size: validated.file_size,
        purpose: validated.purpose,
        status: "pending",
      });

      try {
        const signedUpload = await storage.createSignedUpload(storagePath);
        return uploadTaskSchema.parse({
          asset: toUploadAsset(row, null),
          signed_upload: {
            path: signedUpload.path,
            token: signedUpload.token,
            signed_url: signedUpload.signedUrl,
          },
        });
      } catch (error) {
        await uploads.delete(userId, id);
        throw error;
      }
    },

    async completeUpload(userId, uploadId) {
      const validatedId = uploadIdSchema.parse(uploadId);
      const existing = await uploads.findById(userId, validatedId);

      if (!existing) {
        throw new UploadNotFoundError("UPLOAD_NOT_FOUND");
      }

      if (existing.status === "failed") {
        throw new UploadStateError("UPLOAD_FAILED");
      }

      if (existing.status === "ready") {
        return toReadableUploadAsset(existing, storage);
      }

      const objectInfo = await storage.getObjectInfo(existing.storage_path);

      if (!objectInfo) {
        throw new UploadStateError("UPLOAD_INCOMPLETE");
      }

      if (
        objectInfo.fileSize !== existing.file_size ||
        objectInfo.mimeType !== existing.mime_type
      ) {
        await storage.remove(existing.storage_path);
        await uploads.updateStatus(userId, validatedId, "failed");
        throw new UploadStateError("UPLOAD_METADATA_MISMATCH");
      }

      const completed = await uploads.updateStatus(
        userId,
        validatedId,
        "ready",
      );

      if (!completed) {
        throw new UploadNotFoundError("UPLOAD_NOT_FOUND");
      }

      if (completed.owned_product_id && ownedProducts) {
        const ownedProduct = await ownedProducts.findById(userId, completed.owned_product_id);
        if (!ownedProduct) throw new UploadNotFoundError("UPLOAD_NOT_FOUND");
        const saved = await ownedProducts.update(userId, ownedProduct.id, {
          image_override_upload_id: completed.id,
          updated_at: new Date().toISOString(),
        });
        if (!saved) throw new UploadNotFoundError("UPLOAD_NOT_FOUND");
      }

      return toReadableUploadAsset(completed, storage);
    },

    async deleteUpload(userId, uploadId) {
      const validatedId = uploadIdSchema.parse(uploadId);
      const existing = await uploads.findById(userId, validatedId);

      if (!existing) {
        throw new UploadNotFoundError("UPLOAD_NOT_FOUND");
      }

      await storage.remove(existing.storage_path);
      const deleted = await uploads.delete(userId, validatedId);

      if (!deleted) {
        throw new UploadNotFoundError("UPLOAD_NOT_FOUND");
      }
    },
  };
}
