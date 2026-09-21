import { createAdminProductDiscoveryService } from "@/server/admin/product-discovery-composition";
import {
  adminProductDiscoveryDataResponse,
  adminProductDiscoveryErrorResponse,
  readProductDiscoveryRequest,
} from "@/server/admin/product-discovery-http";
import { requireAdmin } from "@/server/auth/require-admin";

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const input = await readProductDiscoveryRequest(request);
    const service = await createAdminProductDiscoveryService();
    return adminProductDiscoveryDataResponse(await service.search(input));
  } catch (error) {
    return adminProductDiscoveryErrorResponse(error);
  }
}

