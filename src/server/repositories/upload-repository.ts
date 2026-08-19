import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/db/database.types";
import type { UploadListQuery, UploadStatus } from "@/schemas/upload";

export type UploadAssetRow = Tables<"upload_assets">;

type UploadAssetWrite = Pick<
  UploadAssetRow,
  | "id"
  | "product_id"
  | "storage_path"
  | "file_name"
  | "mime_type"
  | "file_size"
  | "purpose"
  | "status"
>;

export type UploadRepository = {
  listByUserId(
    userId: string,
    query: UploadListQuery,
  ): Promise<UploadAssetRow[]>;
  findById(userId: string, uploadId: string): Promise<UploadAssetRow | null>;
  create(userId: string, input: UploadAssetWrite): Promise<UploadAssetRow>;
  updateStatus(
    userId: string,
    uploadId: string,
    status: UploadStatus,
  ): Promise<UploadAssetRow | null>;
  delete(userId: string, uploadId: string): Promise<boolean>;
};

export function createUploadRepository(
  supabase: SupabaseClient<Database>,
): UploadRepository {
  return {
    async listByUserId(userId, query) {
      let request = supabase
        .from("upload_assets")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (query.product_id) {
        request = request.eq("product_id", query.product_id);
      }

      const { data, error } = await request;

      if (error) {
        throw new Error("UPLOAD_READ_FAILED", { cause: error });
      }

      return data;
    },

    async findById(userId, uploadId) {
      const { data, error } = await supabase
        .from("upload_assets")
        .select("*")
        .eq("id", uploadId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("UPLOAD_READ_FAILED", { cause: error });
      }

      return data;
    },

    async create(userId, input) {
      const { data, error } = await supabase
        .from("upload_assets")
        .insert({ ...input, user_id: userId })
        .select("*")
        .single();

      if (error || !data) {
        throw new Error("UPLOAD_CREATE_FAILED", { cause: error });
      }

      return data;
    },

    async updateStatus(userId, uploadId, status) {
      const { data, error } = await supabase
        .from("upload_assets")
        .update({ status })
        .eq("id", uploadId)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error("UPLOAD_UPDATE_FAILED", { cause: error });
      }

      return data;
    },

    async delete(userId, uploadId) {
      const { data, error } = await supabase
        .from("upload_assets")
        .delete()
        .eq("id", uploadId)
        .eq("user_id", userId)
        .select("id");

      if (error) {
        throw new Error("UPLOAD_DELETE_FAILED", { cause: error });
      }

      return data.length > 0;
    },
  };
}
