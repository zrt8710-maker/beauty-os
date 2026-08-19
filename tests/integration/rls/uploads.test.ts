import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";
import { PRODUCT_IMAGE_BUCKET } from "@/schemas/upload";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260818020000_create_upload_assets.sql",
    import.meta.url,
  ),
);

describe("upload assets migration 的 RLS 与 Storage 契约", () => {
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();

  it("创建 upload_assets 并启用当前用户 RLS", () => {
    expect(sql.match(/create\s+table\s+/g)).toHaveLength(1);
    expect(sql).toContain("create table public.upload_assets");
    expect(sql).toContain("alter table public.upload_assets enable row level security");
    expect(sql).toContain("revoke all on table public.upload_assets from anon");
    expect(sql).toContain("(select auth.uid()) = user_id");
  });

  it("创建 private product-images bucket 并限制大小和 MIME", () => {
    expect(sql).toContain("'product-images'");
    expect(sql).toContain("public = false");
    expect(sql).toContain("5242880");
    for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
      expect(sql).toContain(`'${mimeType}'`);
    }
  });

  it("Storage 对象 policy 只能访问 auth.uid() 路径前缀", () => {
    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(sql).toContain(`for ${operation}`);
    }
    expect(sql.match(/storage\.foldername\(name\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("(select auth.uid())::text");
  });
});

const testEnvironment = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  userAEmail: process.env.SUPABASE_TEST_USER_A_EMAIL,
  userAPassword: process.env.SUPABASE_TEST_USER_A_PASSWORD,
  userBEmail: process.env.SUPABASE_TEST_USER_B_EMAIL,
  userBPassword: process.env.SUPABASE_TEST_USER_B_PASSWORD,
};

const hasLiveTestEnvironment = Object.values(testEnvironment).every(Boolean);
const describeLive = hasLiveTestEnvironment ? describe : describe.skip;

describeLive("upload assets 双用户隔离（真实 Supabase Storage）", () => {
  let clientA!: SupabaseClient<Database>;
  let clientB!: SupabaseClient<Database>;
  let userAId = "";
  let userBId = "";
  let productAId = "";
  let productBId = "";
  const uploadAId = crypto.randomUUID();
  const uploadBId = crypto.randomUUID();
  let pathA = "";
  let pathB = "";
  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  beforeAll(async () => {
    clientA = createClient<Database>(testEnvironment.url!, testEnvironment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientB = createClient<Database>(testEnvironment.url!, testEnvironment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [sessionA, sessionB] = await Promise.all([
      clientA.auth.signInWithPassword({
        email: testEnvironment.userAEmail!,
        password: testEnvironment.userAPassword!,
      }),
      clientB.auth.signInWithPassword({
        email: testEnvironment.userBEmail!,
        password: testEnvironment.userBPassword!,
      }),
    ]);

    if (sessionA.error || sessionB.error) {
      throw new Error("RLS test users could not authenticate.");
    }

    userAId = sessionA.data.user.id;
    userBId = sessionB.data.user.id;
    pathA = `${userAId}/${uploadAId}/original.png`;
    pathB = `${userBId}/${uploadBId}/original.png`;

    const [productA, productB] = await Promise.all([
      clientA
        .from("products")
        .insert({
          product_name: "Upload Product A",
          category: "skincare",
          subcategory: "face_care",
          product_type: "serum",
          created_by_user_id: userAId,
        })
        .select("id")
        .single(),
      clientB
        .from("products")
        .insert({
          product_name: "Upload Product B",
          category: "makeup",
          subcategory: "base_makeup",
          product_type: "foundation",
          created_by_user_id: userBId,
        })
        .select("id")
        .single(),
    ]);

    if (productA.error || productB.error) {
      throw new Error("Upload test products could not be created.");
    }

    productAId = productA.data.id;
    productBId = productB.data.id;

    const [assetA, assetB] = await Promise.all([
      clientA.from("upload_assets").insert({
        id: uploadAId,
        user_id: userAId,
        product_id: productAId,
        storage_path: pathA,
        file_name: "a.png",
        mime_type: "image/png",
        file_size: imageBytes.byteLength,
        purpose: "product_image",
      }),
      clientB.from("upload_assets").insert({
        id: uploadBId,
        user_id: userBId,
        product_id: productBId,
        storage_path: pathB,
        file_name: "b.png",
        mime_type: "image/png",
        file_size: imageBytes.byteLength,
        purpose: "product_image",
      }),
    ]);

    if (assetA.error || assetB.error) {
      throw new Error("Upload test asset rows could not be created.");
    }

    await Promise.all([
      uploadSignedImage(clientA, pathA, imageBytes),
      uploadSignedImage(clientB, pathB, imageBytes),
    ]);
  });

  afterAll(async () => {
    if (pathA && pathB) {
      await Promise.all([
        clientA.storage.from(PRODUCT_IMAGE_BUCKET).remove([pathA]),
        clientB.storage.from(PRODUCT_IMAGE_BUCKET).remove([pathB]),
      ]);
    }
    await Promise.all([
      clientA.from("upload_assets").delete().eq("id", uploadAId),
      clientB.from("upload_assets").delete().eq("id", uploadBId),
    ]);
    if (productAId && productBId) {
      await Promise.all([
        clientA.from("products").delete().eq("id", productAId),
        clientB.from("products").delete().eq("id", productBId),
      ]);
    }
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  });

  it("用户可以上传并签名读取自己的 private 图片", async () => {
    const signed = await clientA.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .createSignedUrl(pathA, 60);

    expect(signed.error).toBeNull();
    expect(signed.data?.signedUrl).toContain("token=");
  });

  it("用户不能读取或删除其他用户图片资产记录", async () => {
    const [aReadsB, bReadsA, aDeletesB, bDeletesA] = await Promise.all([
      clientA.from("upload_assets").select("id").eq("id", uploadBId),
      clientB.from("upload_assets").select("id").eq("id", uploadAId),
      clientA.from("upload_assets").delete().eq("id", uploadBId).select("id"),
      clientB.from("upload_assets").delete().eq("id", uploadAId).select("id"),
    ]);

    for (const result of [aReadsB, bReadsA, aDeletesB, bDeletesA]) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
  });

  it("用户不能签发其他用户 Storage 对象的读取 URL", async () => {
    const [aSignsB, bSignsA] = await Promise.all([
      clientA.storage.from(PRODUCT_IMAGE_BUCKET).createSignedUrl(pathB, 60),
      clientB.storage.from(PRODUCT_IMAGE_BUCKET).createSignedUrl(pathA, 60),
    ]);

    expect(aSignsB.error).not.toBeNull();
    expect(bSignsA.error).not.toBeNull();
  });

  it("图片资产不能关联其他用户产品", async () => {
    const invalidId = crypto.randomUUID();
    const attempt = await clientA.from("upload_assets").insert({
      id: invalidId,
      user_id: userAId,
      product_id: productBId,
      storage_path: `${userAId}/${invalidId}/original.png`,
      file_name: "invalid.png",
      mime_type: "image/png",
      file_size: imageBytes.byteLength,
      purpose: "product_image",
    });

    expect(attempt.error).not.toBeNull();
  });
});

async function uploadSignedImage(
  client: SupabaseClient<Database>,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const bucket = client.storage.from(PRODUCT_IMAGE_BUCKET);
  const signed = await bucket.createSignedUploadUrl(path, { upsert: false });

  if (signed.error) {
    throw new Error("Signed upload URL could not be created.");
  }

  const upload = await bucket.uploadToSignedUrl(
    signed.data.path,
    signed.data.token,
    new Blob([bytes], { type: "image/png" }),
    { contentType: "image/png", upsert: false },
  );

  if (upload.error) {
    throw new Error("Signed upload could not be completed.");
  }
}
