import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260818030000_create_product_drafts.sql",
    import.meta.url,
  ),
);

const stabilizationFixPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260819002000_secure_confirm_product_draft.sql",
    import.meta.url,
  ),
);

describe("product drafts migration 的 RLS 与事务契约", () => {
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();
  const stabilizationFix = readFileSync(stabilizationFixPath, "utf8").toLowerCase();

  it("只新增 product_drafts 并开启 owner-only RLS", () => {
    expect(sql.match(/create\s+table\s+/g)).toHaveLength(1);
    expect(sql).toContain("create table public.product_drafts");
    expect(sql).toContain("alter table public.product_drafts enable row level security");
    expect(sql).toContain("(select auth.uid()) = user_id");
    expect(sql).toContain("upload_assets.user_id = (select auth.uid())");
    expect(sql).toContain("upload_assets.status = 'ready'");
  });

  it("source 仅预留 manual/image/ai，但默认始终为 manual", () => {
    expect(sql).toContain("source text not null default 'manual'");
    expect(sql).toContain("source in ('manual', 'image', 'ai')");
  });

  it("单个 security invoker RPC 原子创建产品、库存、图片关联并确认草稿", () => {
    expect(sql).toContain("create or replace function public.confirm_product_draft");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("insert into public.products");
    expect(sql).toContain("insert into public.user_owned_products");
    expect(sql).toContain("update public.upload_assets");
    expect(sql).toContain("update public.product_drafts");
    expect(sql).not.toContain("exception when");
    expect(sql).toContain("revoke all on function public.confirm_product_draft(uuid) from anon");
    expect(sql).toContain("grant execute on function public.confirm_product_draft(uuid) to authenticated");
  });

  it("事务在写入前锁定当前用户的 pending draft 与 ready 图片", () => {
    expect(sql.match(/\n  for update;/g)).toHaveLength(2);
    expect(sql).toContain("and user_id = (select auth.uid())\n    and status = 'pending'");
    expect(sql).toContain("and status = 'ready'\n    and product_id is null");
  });

  it("确认 RPC 以受控 definer 权限执行，保留所有权与 verified 候选校验", () => {
    expect(stabilizationFix).toContain("security definer");
    expect(stabilizationFix).toContain("auth.uid() is null");
    expect(stabilizationFix).toContain("user_id = (select auth.uid())");
    expect(stabilizationFix).toContain("status = 'pending'");
    expect(stabilizationFix).toContain("draft_candidate_not_verified");
    expect(stabilizationFix).toContain("status = 'verified'");
    expect(stabilizationFix).not.toContain("candidate_catalog_product_id =");
    expect(stabilizationFix).not.toContain("match_source =");
    expect(stabilizationFix).not.toContain("match_confidence =");
    expect(stabilizationFix).not.toContain("match_evidence =");
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

describeLive("product drafts 双用户 RLS 与确认事务（真实 Supabase）", () => {
  let clientA!: SupabaseClient<Database>;
  let clientB!: SupabaseClient<Database>;
  let userAId = "";
  let userBId = "";
  const uploadAId = crypto.randomUUID();
  const uploadBId = crypto.randomUUID();
  const rollbackUploadId = crypto.randomUUID();
  let draftAId = "";
  let draftBId = "";
  let rollbackDraftId = "";
  let confirmedProductId = "";
  let confirmedOwnedProductId = "";

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

    const assets = await Promise.all([
      createReadyAsset(clientA, userAId, uploadAId, "draft-a.png"),
      createReadyAsset(clientB, userBId, uploadBId, "draft-b.png"),
      createReadyAsset(clientA, userAId, rollbackUploadId, "rollback.png"),
    ]);

    if (assets.some((result) => result.error)) {
      throw new Error("Product draft test assets could not be created.");
    }

    const [draftA, draftB, rollbackDraft] = await Promise.all([
      clientA
        .from("product_drafts")
        .insert(completeDraft(userAId, uploadAId, "Transaction Product A"))
        .select("id")
        .single(),
      clientB
        .from("product_drafts")
        .insert(completeDraft(userBId, uploadBId, "Transaction Product B"))
        .select("id")
        .single(),
      clientA
        .from("product_drafts")
        .insert({ user_id: userAId, upload_asset_id: rollbackUploadId })
        .select("id")
        .single(),
    ]);

    if (draftA.error || draftB.error || rollbackDraft.error) {
      throw new Error("Product draft test rows could not be created.");
    }

    draftAId = draftA.data.id;
    draftBId = draftB.data.id;
    rollbackDraftId = rollbackDraft.data.id;
  });

  afterAll(async () => {
    if (confirmedOwnedProductId) {
      await clientA
        .from("user_owned_products")
        .delete()
        .eq("id", confirmedOwnedProductId);
    }
    if (confirmedProductId) {
      await clientA
        .from("upload_assets")
        .update({ product_id: null })
        .eq("id", uploadAId);
    }
    await Promise.all([
      clientA.from("upload_assets").delete().eq("id", uploadAId),
      clientB.from("upload_assets").delete().eq("id", uploadBId),
      clientA.from("upload_assets").delete().eq("id", rollbackUploadId),
    ]);
    if (confirmedProductId) {
      await clientA.from("products").delete().eq("id", confirmedProductId);
    }
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  });

  it("用户不能读取或确认其他用户 draft", async () => {
    const [readAttempt, confirmAttempt] = await Promise.all([
      clientA.from("product_drafts").select("id").eq("id", draftBId),
      clientA.rpc("confirm_product_draft", { p_draft_id: draftBId }),
    ]);

    expect(readAttempt.error).toBeNull();
    expect(readAttempt.data).toEqual([]);
    expect(confirmAttempt.error).not.toBeNull();
  });

  it("确认 RPC 不接受候选证据字段，也不会修改草稿候选字段", async () => {
    const tamperAttempt = await clientA.rpc(
      "confirm_product_draft",
      {
        p_draft_id: draftAId,
        p_match_evidence: "forged evidence",
      } as never,
    );
    const draft = await clientA
      .from("product_drafts")
      .select(
        "candidate_catalog_product_id, match_source, match_confidence, match_evidence",
      )
      .eq("id", draftAId)
      .single();

    expect(tamperAttempt.error).not.toBeNull();
    expect(draft.error).toBeNull();
    expect(draft.data).toEqual({
      candidate_catalog_product_id: null,
      match_source: null,
      match_confidence: null,
      match_evidence: null,
    });
  });

  it("确认后真实创建 products、user_owned_products 并更新草稿", async () => {
    const confirmation = await clientA
      .rpc("confirm_product_draft", { p_draft_id: draftAId })
      .single();

    expect(confirmation.error).toBeNull();
    confirmedProductId = confirmation.data!.created_product_id;
    confirmedOwnedProductId = confirmation.data!.created_owned_product_id;

    const [product, ownedProduct, draft, asset] = await Promise.all([
      clientA.from("products").select("id").eq("id", confirmedProductId).single(),
      clientA
        .from("user_owned_products")
        .select("id")
        .eq("id", confirmedOwnedProductId)
        .single(),
      clientA.from("product_drafts").select("status").eq("id", draftAId).single(),
      clientA.from("upload_assets").select("product_id").eq("id", uploadAId).single(),
    ]);

    expect(product.error).toBeNull();
    expect(ownedProduct.error).toBeNull();
    expect(draft.data?.status).toBe("confirmed");
    expect(asset.data?.product_id).toBe(confirmedProductId);
  });

  it("不完整草稿确认失败时没有产品、库存或状态残留", async () => {
    const confirmation = await clientA.rpc("confirm_product_draft", {
      p_draft_id: rollbackDraftId,
    });
    const [draft, asset] = await Promise.all([
      clientA
        .from("product_drafts")
        .select("status")
        .eq("id", rollbackDraftId)
        .single(),
      clientA
        .from("upload_assets")
        .select("product_id")
        .eq("id", rollbackUploadId)
        .single(),
    ]);

    expect(confirmation.error).not.toBeNull();
    expect(draft.data?.status).toBe("pending");
    expect(asset.data?.product_id).toBeNull();
  });
});

function createReadyAsset(
  client: SupabaseClient<Database>,
  userId: string,
  id: string,
  fileName: string,
) {
  return client.from("upload_assets").insert({
    id,
    user_id: userId,
    product_id: null,
    storage_path: `${userId}/${id}/original.png`,
    file_name: fileName,
    mime_type: "image/png",
    file_size: 8,
    purpose: "product_image",
    status: "ready",
  });
}

function completeDraft(userId: string, uploadAssetId: string, productName: string) {
  return {
    user_id: userId,
    upload_asset_id: uploadAssetId,
    brand_name: "Beauty OS",
    product_name: productName,
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    source: "manual",
  };
}
