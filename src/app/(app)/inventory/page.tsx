import { redirect } from "next/navigation";

import { InventoryManager } from "@/features/inventory/inventory-manager";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProductImageStorage } from "@/server/integrations/storage/product-images";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createUploadRepository } from "@/server/repositories/upload-repository";
import { createInventoryService } from "@/server/services/inventory-service";
import { createUploadService } from "@/server/services/upload-service";

export default async function InventoryPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const productRepository = createProductRepository(supabase);
  const service = createInventoryService(
    productRepository,
    createOwnedProductRepository(supabase),
  );
  const uploadService = createUploadService(
    createUploadRepository(supabase),
    productRepository,
    createProductImageStorage(supabase),
  );
  const [products, inventory, uploads] = await Promise.all([
    service.listProducts(user.id, {}),
    service.listOwnedProducts(user.id, {}),
    uploadService.listUploads(user.id, {}),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">Beauty Inventory</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">我的美妆资产库</h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          管理你已经拥有的护肤与彩妆产品，记录使用状态和剩余量。
        </p>
      </div>
      <InventoryManager
        initialInventory={inventory}
        initialProducts={products}
        initialUploads={uploads}
      />
    </main>
  );
}
