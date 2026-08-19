import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductDraftRepository } from "@/server/repositories/product-draft-repository";
import type { UploadRepository } from "@/server/repositories/upload-repository";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  createProductDraftRepository: vi.fn(),
  createUploadRepository: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/auth/get-current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/server/repositories/product-draft-repository", () => ({
  createProductDraftRepository: mocks.createProductDraftRepository,
}));
vi.mock("@/server/repositories/upload-repository", () => ({
  createUploadRepository: mocks.createUploadRepository,
}));

import { POST as confirmDraft } from "@/app/api/v1/product-drafts/[id]/confirm/route";
import {
  DELETE as deleteDraft,
  PATCH as patchDraft,
} from "@/app/api/v1/product-drafts/[id]/route";
import {
  GET as getDrafts,
  POST as postDraft,
} from "@/app/api/v1/product-drafts/route";

const draftId = "40000000-0000-4000-8000-000000000001";
const uploadId = "30000000-0000-4000-8000-000000000001";
const productId = "10000000-0000-4000-8000-000000000001";
const ownedProductId = "20000000-0000-4000-8000-000000000001";

const draftRow = {
  id: draftId,
  user_id: "user-a",
  upload_asset_id: uploadId,
  brand_name: "Beauty OS",
  product_name: "保湿精华",
  category: "skincare",
  subcategory: "face_care",
  product_type: "serum",
  notes: null,
  source: "manual",
  status: "pending",
  created_at: "2026-08-18T03:00:00.000Z",
  updated_at: "2026-08-18T03:00:00.000Z",
};

const uploadRow = {
  id: uploadId,
  user_id: "user-a",
  product_id: null,
  storage_path: `user-a/${uploadId}/original.png`,
  file_name: "精华.png",
  mime_type: "image/png",
  file_size: 1024,
  purpose: "product_image",
  status: "ready",
  created_at: "2026-08-18T03:00:00.000Z",
};

describe("product drafts API", () => {
  let drafts: ProductDraftRepository;
  let uploads: UploadRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    drafts = {
      listByUserId: vi.fn().mockResolvedValue([draftRow]),
      findById: vi.fn().mockResolvedValue(draftRow),
      create: vi.fn().mockResolvedValue(draftRow),
      update: vi.fn().mockResolvedValue(draftRow),
      reject: vi.fn().mockResolvedValue({ ...draftRow, status: "rejected" }),
      saveCandidate: vi.fn(),
      confirmTransaction: vi.fn().mockResolvedValue({
        created_product_id: productId,
        created_owned_product_id: ownedProductId,
      }),
    };
    uploads = {
      listByUserId: vi.fn().mockResolvedValue([uploadRow]),
      findById: vi.fn().mockResolvedValue(uploadRow),
      create: vi.fn().mockResolvedValue(uploadRow),
      updateStatus: vi.fn().mockResolvedValue(uploadRow),
      delete: vi.fn().mockResolvedValue(true),
    };
    mocks.createClient.mockResolvedValue({});
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a", email: "a@example.com" });
    mocks.createProductDraftRepository.mockReturnValue(drafts);
    mocks.createUploadRepository.mockReturnValue(uploads);
  });

  it("用户可以创建自己的 draft", async () => {
    const response = await postDraft(
      jsonRequest("http://localhost/api/v1/product-drafts", "POST", {
        upload_asset_id: uploadId,
      }),
    );

    expect(response.status).toBe(201);
    expect(uploads.findById).toHaveBeenCalledWith("user-a", uploadId);
    expect(drafts.create).toHaveBeenCalledWith("user-a", uploadId);
  });

  it("列表只使用 session 用户，不能指定读取其他用户 draft", async () => {
    const response = await getDrafts(
      new Request("http://localhost/api/v1/product-drafts?status=pending&user_id=user-b"),
    );

    expect(response.status).toBe(200);
    expect(drafts.listByUserId).toHaveBeenCalledWith("user-a", { status: "pending" });
    expect(drafts.listByUserId).not.toHaveBeenCalledWith("user-b", expect.anything());
  });

  it("用户不能确认其他用户 draft", async () => {
    vi.mocked(drafts.findById).mockResolvedValue(null);
    const response = await confirmDraft(
      new Request(`http://localhost/api/v1/product-drafts/${draftId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "manual" }),
      }),
      routeContext(draftId),
    );

    expect(response.status).toBe(404);
    expect(drafts.findById).toHaveBeenCalledWith("user-a", draftId);
    expect(drafts.confirmTransaction).not.toHaveBeenCalled();
  });

  it("确认后一次事务返回新 products 与 user_owned_products ID", async () => {
    const response = await confirmDraft(
      new Request(`http://localhost/api/v1/product-drafts/${draftId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "manual" }),
      }),
      routeContext(draftId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(drafts.confirmTransaction).toHaveBeenCalledTimes(1);
    expect(body.data).toEqual({ product_id: productId, owned_product_id: ownedProductId });
  });

  it("事务失败返回 500 且不伪造成功状态", async () => {
    vi.mocked(drafts.confirmTransaction).mockRejectedValue(new Error("DB_FAILED"));
    const response = await confirmDraft(
      new Request(`http://localhost/api/v1/product-drafts/${draftId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "manual" }),
      }),
      routeContext(draftId),
    );

    expect(response.status).toBe(500);
    expect(drafts.update).not.toHaveBeenCalled();
    expect(drafts.reject).not.toHaveBeenCalled();
  });

  it("非法分类输入被 Zod 拒绝", async () => {
    const response = await patchDraft(
      jsonRequest(`http://localhost/api/v1/product-drafts/${draftId}`, "PATCH", {
        category: "random_category",
      }),
      routeContext(draftId),
    );

    expect(response.status).toBe(400);
    expect(drafts.update).not.toHaveBeenCalled();
  });

  it("客户端不能提交 user_id", async () => {
    const response = await postDraft(
      jsonRequest("http://localhost/api/v1/product-drafts", "POST", {
        upload_asset_id: uploadId,
        user_id: "user-b",
      }),
    );

    expect(response.status).toBe(400);
    expect(drafts.create).not.toHaveBeenCalled();
  });

  it("未登录无法读取、创建、修改、确认或删除 draft", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const [list, create, update, confirm, remove] = await Promise.all([
      getDrafts(new Request("http://localhost/api/v1/product-drafts")),
      postDraft(jsonRequest("http://localhost/api/v1/product-drafts", "POST", { upload_asset_id: uploadId })),
      patchDraft(jsonRequest(`http://localhost/api/v1/product-drafts/${draftId}`, "PATCH", { notes: "x" }), routeContext(draftId)),
      confirmDraft(new Request(`http://localhost/api/v1/product-drafts/${draftId}/confirm`, { method: "POST" }), routeContext(draftId)),
      deleteDraft(new Request(`http://localhost/api/v1/product-drafts/${draftId}`, { method: "DELETE" }), routeContext(draftId)),
    ]);

    expect([list, create, update, confirm, remove].map((item) => item.status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

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
