import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCatalogSeedDryRunChecker,
  type CatalogSeedDryRunChecker,
} from "@/server/catalog-seed/catalog-seed-dry-run";
import { createCatalogSeedLookupRepository } from "@/server/repositories/catalog-seed-lookup-repository";
import { createCatalogSeedWriteRepository } from "@/server/repositories/catalog-seed-write-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import {
  createCatalogSeedService,
  type CatalogSeedService,
} from "@/server/services/catalog-seed-service";

const trustedCatalogSeedRead = {
  rls_access: "service_role",
  purpose: "catalog_seed_dry_run",
} as const;

export function createAdminCatalogSeedDryRunChecker(): CatalogSeedDryRunChecker {
  const adminClient = createAdminClient();
  return createTrustedDryRunChecker(adminClient);
}

export function createAdminCatalogSeedService(): CatalogSeedService {
  const adminClient = createAdminClient();
  const dryRun = createTrustedDryRunChecker(adminClient);

  return createCatalogSeedService(
    dryRun,
    createCatalogSeedWriteRepository(adminClient),
    createKnowledgeRepository(adminClient),
  );
}

function createTrustedDryRunChecker(
  adminClient: ReturnType<typeof createAdminClient>,
) {
  return createCatalogSeedDryRunChecker(
    createCatalogSeedLookupRepository(
      adminClient,
      trustedCatalogSeedRead,
    ),
  );
}
