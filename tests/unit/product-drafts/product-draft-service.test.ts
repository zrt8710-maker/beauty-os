import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductDraftRepository } from "@/server/repositories/product-draft-repository";
import type { UploadRepository } from "@/server/repositories/upload-repository";
import {
  ProductDraftNotFoundError,
  createProductDraftService,
} from "@/server/services/product-draft-service";

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
  barcode: null,
  candidate_catalog_product_id: null,
  match_source: null,
  match_confidence: null,
  match_evidence: null,
  knowledge_confirmed_at: null,
  notes: "人工确认",
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

describe("ProductDraftService", () => {
  let drafts: ProductDraftRepository;
  let uploads: UploadRepository;

  beforeEach(() => {
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
  });

  it("用户使用自己的 ready 图片创建 manual draft", async () => {
    const service = createProductDraftService(drafts, uploads);
    const result = await service.createDraft("user-a", {
      upload_asset_id: uploadId,
    });

    expect(uploads.findById).toHaveBeenCalledWith("user-a", uploadId);
    expect(drafts.create).toHaveBeenCalledWith("user-a", uploadId);
    expect(result.source).toBe("manual");
  });

  it("用户不能使用其他用户的图片创建草稿", async () => {
    vi.mocked(uploads.findById).mockResolvedValue(null);
    const service = createProductDraftService(drafts, uploads);

    await expect(
      service.createDraft("user-a", { upload_asset_id: uploadId }),
    ).rejects.toEqual(new ProductDraftNotFoundError("UPLOAD_NOT_FOUND"));
    expect(drafts.create).not.toHaveBeenCalled();
  });

  it("确认草稿只调用一次数据库事务并返回产品与库存 ID", async () => {
    const service = createProductDraftService(drafts, uploads);
    const result = await service.confirmDraft("user-a", draftId, { confirmation: "manual" });

    expect(drafts.findById).toHaveBeenCalledWith("user-a", draftId);
    expect(drafts.confirmTransaction).toHaveBeenCalledTimes(1);
    expect(drafts.confirmTransaction).toHaveBeenCalledWith(draftId, null);
    expect(result).toEqual({ product_id: productId, owned_product_id: ownedProductId });
  });

  it("用户明确关联候选时才把候选目录 ID 传入确认事务", async () => {
    const catalogProductId = "50000000-0000-4000-8000-000000000001";
    vi.mocked(drafts.findById).mockResolvedValue({ ...draftRow, candidate_catalog_product_id: catalogProductId });
    const service = createProductDraftService(drafts, uploads);
    await service.confirmDraft("user-a", draftId, { confirmation: "link_candidate" });
    expect(drafts.confirmTransaction).toHaveBeenCalledWith(draftId, catalogProductId);
  });

  it("数据库事务失败时向上返回失败且不执行任何补偿性状态修改", async () => {
    vi.mocked(drafts.confirmTransaction).mockRejectedValue(
      new Error("PRODUCT_DRAFT_CONFIRM_FAILED"),
    );
    const service = createProductDraftService(drafts, uploads);

    await expect(service.confirmDraft("user-a", draftId, { confirmation: "manual" })).rejects.toThrow(
      "PRODUCT_DRAFT_CONFIRM_FAILED",
    );
    expect(drafts.update).not.toHaveBeenCalled();
    expect(drafts.reject).not.toHaveBeenCalled();
  });
});
