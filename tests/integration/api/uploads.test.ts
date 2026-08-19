import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_PRODUCT_IMAGE_BYTES } from "@/schemas/upload";
import type { ProductImageStorage } from "@/server/integrations/storage/product-images";
import type { ProductRepository } from "@/server/repositories/product-repository";
import type { UploadRepository } from "@/server/repositories/upload-repository";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  createProductRepository: vi.fn(),
  createUploadRepository: vi.fn(),
  createProductImageStorage: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/auth/get-current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/server/repositories/product-repository", () => ({
  createProductRepository: mocks.createProductRepository,
}));
vi.mock("@/server/repositories/upload-repository", () => ({
  createUploadRepository: mocks.createUploadRepository,
}));
vi.mock("@/server/integrations/storage/product-images", () => ({
  createProductImageStorage: mocks.createProductImageStorage,
}));

import { DELETE as deleteUpload } from "@/app/api/v1/uploads/[id]/route";
import { POST as completeUpload } from "@/app/api/v1/uploads/[id]/complete/route";
import { GET as getUploads, POST as postUpload } from "@/app/api/v1/uploads/route";

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

describe("uploads API", () => {
  let products: ProductRepository;
  let uploads: UploadRepository;
  let storage: ProductImageStorage;

  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.createClient.mockResolvedValue({});
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-a",
      email: "a@example.com",
    });
    mocks.createProductRepository.mockReturnValue(products);
    mocks.createUploadRepository.mockReturnValue(uploads);
    mocks.createProductImageStorage.mockReturnValue(storage);
  });

  it("用户可以创建并完成自己的图片上传", async () => {
    const createResponse = await postUpload(
      jsonRequest("http://localhost/api/v1/uploads", "POST", validInput()),
    );
    const completeResponse = await completeUpload(
      new Request(
        `http://localhost/api/v1/uploads/${uploadRow.id}/complete`,
        { method: "POST" },
      ),
      routeContext(uploadRow.id),
    );
    const completeBody = await completeResponse.json();

    expect(createResponse.status).toBe(201);
    expect(completeResponse.status).toBe(200);
    expect(uploads.create).toHaveBeenCalledWith("user-a", expect.any(Object));
    expect(completeBody.data.status).toBe("ready");
    expect(completeBody.data.signed_url).toContain("/storage/sign/");
  });

  it("获取列表时只使用 session 用户身份", async () => {
    const response = await getUploads(
      new Request("http://localhost/api/v1/uploads?user_id=user-b"),
    );

    expect(response.status).toBe(200);
    expect(uploads.listByUserId).toHaveBeenCalledWith("user-a", {
      product_id: undefined,
    });
    expect(uploads.listByUserId).not.toHaveBeenCalledWith(
      "user-b",
      expect.any(Object),
    );
  });

  it("用户不能删除其他用户图片", async () => {
    vi.mocked(uploads.findById).mockResolvedValue(null);
    const otherId = "30000000-0000-4000-8000-000000000002";
    const response = await deleteUpload(
      new Request(`http://localhost/api/v1/uploads/${otherId}`, {
        method: "DELETE",
      }),
      routeContext(otherId),
    );

    expect(response.status).toBe(404);
    expect(uploads.findById).toHaveBeenCalledWith("user-a", otherId);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("非法文件类型被 Zod 拒绝", async () => {
    const response = await postUpload(
      jsonRequest("http://localhost/api/v1/uploads", "POST", {
        ...validInput(),
        file_name: "image.svg",
        mime_type: "image/svg+xml",
      }),
    );

    expect(response.status).toBe(400);
    expect(uploads.create).not.toHaveBeenCalled();
  });

  it("超过 5 MB 的文件被 Zod 拒绝", async () => {
    const response = await postUpload(
      jsonRequest("http://localhost/api/v1/uploads", "POST", {
        ...validInput(),
        file_size: MAX_PRODUCT_IMAGE_BYTES + 1,
      }),
    );

    expect(response.status).toBe(400);
    expect(uploads.create).not.toHaveBeenCalled();
  });

  it("未登录用户不能创建上传任务", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await postUpload(
      jsonRequest("http://localhost/api/v1/uploads", "POST", validInput()),
    );

    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(uploads.create).not.toHaveBeenCalled();
  });
});

function validInput() {
  return {
    file_name: "精华.png",
    mime_type: "image/png",
    file_size: 1024,
    purpose: "product_image",
    product_id: productRow.id,
  };
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
