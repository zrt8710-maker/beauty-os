import { requireAdmin } from "@/server/auth/require-admin";
import { createAdminCatalogSeedService } from "@/server/admin/catalog-seed-composition";
import {
  adminCatalogSeedDataResponse,
  adminCatalogSeedErrorResponse,
  readCatalogSeedRequest,
} from "@/server/admin/catalog-seed-http";

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const service = createAdminCatalogSeedService();
    const input = await readCatalogSeedRequest(request);
    const result = await service.apply(input);

    return adminCatalogSeedDataResponse({
      receipt: result.receipt,
      product: result.readback,
      warnings: result.warnings,
    });
  } catch (error) {
    return adminCatalogSeedErrorResponse(error, "apply");
  }
}
