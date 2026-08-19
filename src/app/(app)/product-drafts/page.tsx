import { redirect } from "next/navigation";

import { ProductDraftsManager } from "@/features/product-drafts/product-drafts-manager";
import { catalogProductSchema, type CatalogProduct } from "@/schemas/knowledge";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProductImageStorage } from "@/server/integrations/storage/product-images";
import { createProductDraftRepository } from "@/server/repositories/product-draft-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createUploadRepository } from "@/server/repositories/upload-repository";
import { createProductDraftService } from "@/server/services/product-draft-service";
import { createUploadService } from "@/server/services/upload-service";

export default async function ProductDraftsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const uploads = createUploadRepository(supabase);
  const knowledge = createKnowledgeRepository(supabase);
  const draftService = createProductDraftService(
    createProductDraftRepository(supabase),
    uploads,
  );
  const uploadService = createUploadService(
    uploads,
    createProductRepository(supabase),
    createProductImageStorage(supabase),
  );
  const [drafts, assets] = await Promise.all([
    draftService.listDrafts(user.id, { status: "pending" }),
    uploadService.listUploads(user.id, {}),
  ]);
  const candidateEntries = await Promise.all(drafts.map(async (draft) => ({
    draftId: draft.id,
    candidate: draft.candidate_catalog_product_id
      ? await knowledge.findVerifiedProduct(draft.candidate_catalog_product_id)
      : null,
  })));
  const candidates: Record<string, CatalogProduct> = {};
  for (const entry of candidateEntries) {
    if (entry.candidate) candidates[entry.draftId] = catalogProductSchema.parse(entry.candidate);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">Manual confirmation</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">产品草稿</h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          图片仅作为档案资料。品牌、名称和分类全部由你填写并确认，系统不会猜测产品信息。
        </p>
      </div>
      <ProductDraftsManager initialCandidates={candidates} initialDrafts={drafts} initialUploads={assets} />
    </main>
  );
}
