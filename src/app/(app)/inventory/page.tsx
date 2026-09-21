import { redirect } from "next/navigation";

import { InventoryManager } from "@/features/inventory/inventory-manager";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProductImageStorage } from "@/server/integrations/storage/product-images";
import { hydrateOwnedProductCatalogImages } from "@/server/inventory/catalog-image-hydration";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createUploadRepository } from "@/server/repositories/upload-repository";
import { createInventoryService } from "@/server/services/inventory-service";
import { createUploadService, resolveOwnedProductImage } from "@/server/services/upload-service";

export default async function InventoryPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const productRepository = createProductRepository(supabase);
  const uploadRepository = createUploadRepository(supabase);
  const service = createInventoryService(productRepository, createOwnedProductRepository(supabase));
  const uploadService = createUploadService(
    uploadRepository,
    productRepository,
    createProductImageStorage(supabase),
    createOwnedProductRepository(supabase),
  );
  const [ownedProducts, uploads] = await Promise.all([
    service.listOwnedProducts(user.id, {}),
    uploadService.listUploads(user.id, {}),
  ]);
  const inventory = await hydrateOwnedProductCatalogImages(
    ownedProducts,
    createAdminClient(),
  );

  return (
    <main className="beauty-ambient-inventory beauty-ambient-page beauty-page min-h-svh">
      <InventoryManager
        initialInventory={inventory.map((ownedProduct) => resolveOwnedProductImage(ownedProduct, uploads))}
        initialUploads={uploads}
      />
    </main>
  );
}
