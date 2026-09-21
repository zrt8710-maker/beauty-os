import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createCatalogSeedDryRunChecker: vi.fn(),
  createCatalogSeedLookupRepository: vi.fn(),
  createCatalogSeedWriteRepository: vi.fn(),
  createKnowledgeRepository: vi.fn(),
  createCatalogSeedService: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/server/catalog-seed/catalog-seed-dry-run", () => ({
  createCatalogSeedDryRunChecker: mocks.createCatalogSeedDryRunChecker,
}));

vi.mock("@/server/repositories/catalog-seed-lookup-repository", () => ({
  createCatalogSeedLookupRepository:
    mocks.createCatalogSeedLookupRepository,
}));

vi.mock("@/server/repositories/catalog-seed-write-repository", () => ({
  createCatalogSeedWriteRepository:
    mocks.createCatalogSeedWriteRepository,
}));

vi.mock("@/server/repositories/knowledge-repository", () => ({
  createKnowledgeRepository: mocks.createKnowledgeRepository,
}));

vi.mock("@/server/services/catalog-seed-service", () => ({
  createCatalogSeedService: mocks.createCatalogSeedService,
}));

import {
  createAdminCatalogSeedDryRunChecker,
  createAdminCatalogSeedService,
} from "@/server/admin/catalog-seed-composition";

describe("Admin Catalog Seed composition", () => {
  const adminClient = { kind: "service-role-client" };
  const lookupRepository = { inspect: vi.fn() };
  const dryRun = { run: vi.fn() };
  const writeRepository = { applyAtomically: vi.fn() };
  const readRepository = { findVerifiedProduct: vi.fn() };
  const service = { apply: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminClient.mockReturnValue(adminClient);
    mocks.createCatalogSeedLookupRepository.mockReturnValue(lookupRepository);
    mocks.createCatalogSeedDryRunChecker.mockReturnValue(dryRun);
    mocks.createCatalogSeedWriteRepository.mockReturnValue(writeRepository);
    mocks.createKnowledgeRepository.mockReturnValue(readRepository);
    mocks.createCatalogSeedService.mockReturnValue(service);
  });

  it("builds dry-run with trusted reads and no write-capable dependency", () => {
    expect(createAdminCatalogSeedDryRunChecker()).toBe(dryRun);

    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.createCatalogSeedLookupRepository).toHaveBeenCalledWith(
      adminClient,
      {
        rls_access: "service_role",
        purpose: "catalog_seed_dry_run",
      },
    );
    expect(mocks.createCatalogSeedDryRunChecker).toHaveBeenCalledWith(
      lookupRepository,
    );
    expect(mocks.createCatalogSeedWriteRepository).not.toHaveBeenCalled();
    expect(mocks.createKnowledgeRepository).not.toHaveBeenCalled();
    expect(mocks.createCatalogSeedService).not.toHaveBeenCalled();
  });

  it("builds apply with preflight, one RPC repository, and readback", () => {
    expect(createAdminCatalogSeedService()).toBe(service);

    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.createCatalogSeedService).toHaveBeenCalledWith(
      dryRun,
      writeRepository,
      readRepository,
    );
    expect(mocks.createCatalogSeedWriteRepository).toHaveBeenCalledWith(
      adminClient,
    );
    expect(mocks.createKnowledgeRepository).toHaveBeenCalledWith(adminClient);
  });
});
