import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminPageAccess } from "@/server/admin/require-admin-page-access";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createProductResearchDraftService } from "@/server/services/product-research-draft-service";
export default async function ResearchDraftDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPageAccess();
  const draft = await createProductResearchDraftService(createProductResearchDraftRepository(createAdminClient())).getDraft((await params).id).catch(() => null);
  if (!draft) notFound();
  redirect(`/admin/knowledge/products/${draft.catalog_product_id}`);
}
