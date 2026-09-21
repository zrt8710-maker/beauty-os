import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createCatalogSeedDryRunChecker } from "@/server/catalog-seed/catalog-seed-dry-run";
import { createCatalogSeedLookupRepository } from "@/server/repositories/catalog-seed-lookup-repository";
import { createCatalogSeedWriteRepository } from "@/server/repositories/catalog-seed-write-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductKnowledgeCurationRepository } from "@/server/repositories/product-knowledge-curation-repository";
import { createProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";
import { createCatalogSeedService } from "@/server/services/catalog-seed-service";
import { createProductKnowledgeCurationImportRunner } from "@/server/services/product-knowledge-curation-import-runner";
import { createProductKnowledgeCurationService } from "@/server/services/product-knowledge-curation-service";
import { createProductKnowledgeSeedWorkflow } from "@/server/services/product-knowledge-seed-workflow";

const trustedCatalogSeedRead = {
  rls_access: "service_role",
  purpose: "catalog_seed_dry_run",
} as const;

export function createAdminProductKnowledgeSeedWorkflow() {
  const adminClient = createAdminClient();
  const catalogDryRun = createCatalogSeedDryRunChecker(
    createCatalogSeedLookupRepository(adminClient, trustedCatalogSeedRead),
  );
  const catalogService = createCatalogSeedService(
    catalogDryRun,
    createCatalogSeedWriteRepository(adminClient),
    createKnowledgeRepository(adminClient),
  );
  const curationService = createProductKnowledgeCurationService(
    createProductKnowledgeCurationRepository(adminClient),
    createProductKnowledgeRepository(adminClient),
  );

  return createProductKnowledgeSeedWorkflow({
    catalogDryRun,
    catalogService,
    curationRunner: createProductKnowledgeCurationImportRunner(
      curationService,
    ),
  });
}
