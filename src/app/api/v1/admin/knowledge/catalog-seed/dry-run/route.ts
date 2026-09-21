import { requireAdmin } from "@/server/auth/require-admin";
import { createAdminCatalogSeedDryRunChecker } from "@/server/admin/catalog-seed-composition";
import {
  adminCatalogSeedDataResponse,
  adminCatalogSeedErrorResponse,
  readCatalogSeedRequest,
} from "@/server/admin/catalog-seed-http";

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const dryRun = createAdminCatalogSeedDryRunChecker();
    const input = await readCatalogSeedRequest(request);
    const preview = await dryRun.run(input);

    return adminCatalogSeedDataResponse(preview);
  } catch (error) {
    return adminCatalogSeedErrorResponse(error, "dry-run");
  }
}
