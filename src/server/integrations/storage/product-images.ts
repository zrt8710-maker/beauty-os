import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { PRODUCT_IMAGE_BUCKET } from "@/schemas/upload";

const SIGNED_DOWNLOAD_TTL_SECONDS = 10 * 60;

export type StoredObjectInfo = {
  fileSize: number;
  mimeType: string;
};

export type ProductImageStorage = {
  createSignedUpload(path: string): Promise<{
    path: string;
    token: string;
    signedUrl: string;
  }>;
  getObjectInfo(path: string): Promise<StoredObjectInfo | null>;
  createSignedDownload(path: string): Promise<string>;
  remove(path: string): Promise<void>;
};

export function createProductImageStorage(
  supabase: SupabaseClient<Database>,
): ProductImageStorage {
  const bucket = supabase.storage.from(PRODUCT_IMAGE_BUCKET);

  return {
    async createSignedUpload(path) {
      const { data, error } = await bucket.createSignedUploadUrl(path, {
        upsert: false,
      });

      if (error || !data) {
        throw new Error("SIGNED_UPLOAD_CREATE_FAILED", { cause: error });
      }

      return {
        path: data.path,
        token: data.token,
        signedUrl: data.signedUrl,
      };
    },

    async getObjectInfo(path) {
      const { data: exists, error: existenceError } = await bucket.exists(path);

      if (
        existenceError &&
        existenceError.status !== 400 &&
        existenceError.status !== 404
      ) {
        throw new Error("UPLOAD_OBJECT_READ_FAILED", {
          cause: existenceError,
        });
      }

      if (!exists) {
        return null;
      }

      const { data, error } = await bucket.info(path);

      if (error || !data) {
        throw new Error("UPLOAD_OBJECT_READ_FAILED", { cause: error });
      }

      if (typeof data.size !== "number" || typeof data.contentType !== "string") {
        throw new Error("UPLOAD_OBJECT_METADATA_INVALID");
      }

      return {
        fileSize: data.size,
        mimeType: data.contentType,
      };
    },

    async createSignedDownload(path) {
      const { data, error } = await bucket.createSignedUrl(
        path,
        SIGNED_DOWNLOAD_TTL_SECONDS,
      );

      if (error || !data) {
        throw new Error("SIGNED_DOWNLOAD_CREATE_FAILED", { cause: error });
      }

      return data.signedUrl;
    },

    async remove(path) {
      const { error } = await bucket.remove([path]);

      if (error) {
        throw new Error("UPLOAD_OBJECT_DELETE_FAILED", { cause: error });
      }
    },
  };
}
