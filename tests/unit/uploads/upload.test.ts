import { describe, expect, it } from "vitest";

import {
  MAX_PRODUCT_IMAGE_BYTES,
  uploadCreateSchema,
} from "@/schemas/upload";

const validUpload = {
  file_name: "精华正面.png",
  mime_type: "image/png",
  file_size: 1024,
  purpose: "product_image",
  product_id: "10000000-0000-4000-8000-000000000001",
};

describe("uploadCreateSchema", () => {
  it("接受 JPEG、PNG、WebP 和文件大小边界", () => {
    for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
      expect(
        uploadCreateSchema.safeParse({
          ...validUpload,
          mime_type: mimeType,
          file_size: mimeType === "image/jpeg" ? 1 : MAX_PRODUCT_IMAGE_BYTES,
        }).success,
      ).toBe(true);
    }
  });

  it("拒绝非法文件类型", () => {
    expect(
      uploadCreateSchema.safeParse({
        ...validUpload,
        file_name: "payload.svg",
        mime_type: "image/svg+xml",
      }).success,
    ).toBe(false);
  });

  it("拒绝空文件和超过 5 MB 的文件", () => {
    expect(
      uploadCreateSchema.safeParse({ ...validUpload, file_size: 0 }).success,
    ).toBe(false);
    expect(
      uploadCreateSchema.safeParse({
        ...validUpload,
        file_size: MAX_PRODUCT_IMAGE_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it("拒绝客户端身份字段和控制字符文件名", () => {
    expect(
      uploadCreateSchema.safeParse({
        ...validUpload,
        user_id: "user-b",
      }).success,
    ).toBe(false);
    expect(
      uploadCreateSchema.safeParse({
        ...validUpload,
        file_name: "bad\u0000name.png",
      }).success,
    ).toBe(false);
  });
});
