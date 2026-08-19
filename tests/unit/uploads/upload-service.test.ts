import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductImageStorage } from "@/server/integrations/storage/product-images";
import type { ProductRepository } from "@/server/repositories/product-repository";
import type { UploadRepository } from "@/server/repositories/upload-repository";
import {
  UploadStateError,
  createUploadService,
} from "@/server/services/upload-service";

const productRow = {
  id: "10000000-0000-4000-8000-000000000001",
  brand_name: "Beauty OS",
  product_name: "保湿精华",
  category: "skincare",
  subcategory: "face_care",
  product_type: "serum",
  created_by_user_id: "user-a",
  created_at: "2026-08-18T01:00:00.000Z",
  updated_at: "2026-08-18T01:00:00.000Z",
};

const uploadRow = {
  id: "30000000-0000-4000-8000-000000000001",
  user_id: "user-a",
  product_id: productRow.id,
  storage_path:
    "user-a/30000000-0000-4000-8000-000000000001/original.png",
  file_name: "精华.png",
  mime_type: "image/png",
  file_size: 1024,
  purpose: "product_image",
  status: "pending",
  created_at: "2026-08-18T03:00:00.000Z",
};

describe("UploadService", () => {
  let products: ProductRepository;
  let uploads: UploadRepository;
  let storage: ProductImageStorage;

  beforeEach(() => {
    products = {
      listByUserId: vi.fn().mockResolvedValue([productRow]),
      findById: vi.fn().mockResolvedValue(productRow),
      create: vi.fn().mockResolvedValue(productRow),
    };
    uploads = {
      listByUserId: vi.fn().mockResolvedValue([uploadRow]),
      findById: vi.fn().mockResolvedValue(uploadRow),
      create: vi.fn().mockResolvedValue(uploadRow),
      updateStatus: vi.fn().mockResolvedValue({
        ...uploadRow,
        status: "ready",
      }),
      delete: vi.fn().mockResolvedValue(true),
    };
    storage = {
      createSignedUpload: vi.fn().mockResolvedValue({
        path: uploadRow.storage_path,
        token: "signed-upload-token",
        signedUrl: "https://example.supabase.co/storage/upload?token=test",
      }),
      getObjectInfo: vi.fn().mockResolvedValue({
        fileSize: uploadRow.file_size,
        mimeType: uploadRow.mime_type,
      }),
      createSignedDownload: vi
        .fn()
        .mockResolvedValue("https://example.supabase.co/storage/sign/test"),
      remove: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("为当前用户产品创建私有 signed upload task", async () => {
    const service = createUploadService(uploads, products, storage);
    const task = await service.createUploadTask("user-a", {
      file_name: "精华.png",
      mime_type: "image/png",
      file_size: 1024,
      purpose: "product_image",
      product_id: productRow.id,
    });

    expect(products.findById).toHaveBeenCalledWith("user-a", productRow.id);
    expect(uploads.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        product_id: productRow.id,
        status: "pending",
        storage_path: expect.stringMatching(/^user-a\/.+\/original\.png$/),
      }),
    );
    expect(task.signed_upload.token).toBe("signed-upload-token");
    expect(task.asset.signed_url).toBeNull();
  });

  it("允许在产品确认前创建未关联产品的图片资产", async () => {
    const unlinkedUpload = { ...uploadRow, product_id: null };
    vi.mocked(uploads.create).mockResolvedValue(unlinkedUpload);
    const service = createUploadService(uploads, products, storage);
    const task = await service.createUploadTask("user-a", {
      file_name: "精华.png",
      mime_type: "image/png",
      file_size: 1024,
      purpose: "product_image",
      product_id: null,
    });

    expect(products.findById).not.toHaveBeenCalled();
    expect(uploads.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ product_id: null }),
    );
    expect(task.asset.product_id).toBeNull();
  });

  it("核对 Storage 元数据后完成上传并签发下载 URL", async () => {
    const service = createUploadService(uploads, products, storage);
    const completed = await service.completeUpload("user-a", uploadRow.id);

    expect(storage.getObjectInfo).toHaveBeenCalledWith(uploadRow.storage_path);
    expect(uploads.updateStatus).toHaveBeenCalledWith(
      "user-a",
      uploadRow.id,
      "ready",
    );
    expect(completed.status).toBe("ready");
    expect(completed.signed_url).toContain("/storage/sign/");
  });

  it("真实文件元数据不匹配时删除对象并标记 failed", async () => {
    vi.mocked(storage.getObjectInfo).mockResolvedValue({
      fileSize: uploadRow.file_size + 1,
      mimeType: uploadRow.mime_type,
    });
    const service = createUploadService(uploads, products, storage);

    await expect(
      service.completeUpload("user-a", uploadRow.id),
    ).rejects.toEqual(new UploadStateError("UPLOAD_METADATA_MISMATCH"));
    expect(storage.remove).toHaveBeenCalledWith(uploadRow.storage_path);
    expect(uploads.updateStatus).toHaveBeenCalledWith(
      "user-a",
      uploadRow.id,
      "failed",
    );
  });

  it("删除当前用户图片时同时删除 Storage 对象和数据库记录", async () => {
    const service = createUploadService(uploads, products, storage);
    await service.deleteUpload("user-a", uploadRow.id);

    expect(uploads.findById).toHaveBeenCalledWith("user-a", uploadRow.id);
    expect(storage.remove).toHaveBeenCalledWith(uploadRow.storage_path);
    expect(uploads.delete).toHaveBeenCalledWith("user-a", uploadRow.id);
  });
});
