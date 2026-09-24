import { describe, expect, it, vi } from "vitest";

import type { OwnedProductIdentityRepository } from "@/server/repositories/owned-product-identity-repository";
import {
  CatalogIdentityMismatchError,
  createOwnedProductWithIdentityService,
} from "@/server/services/create-owned-product-with-identity-service";
import type { ProductIdentityMatcher } from "@/server/services/product-identity-matching-service";
import { issueRecognitionConfirmationToken } from "@/server/product-recognition/recognition-confirmation-token";
import type { ConfirmedCatalogCandidateRepository } from "@/server/repositories/confirmed-catalog-candidate-repository";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const catalogId = "20000000-0000-4000-8000-000000000001";
const productId = "10000000-0000-4000-8000-000000000001";
const ownedProductId = "30000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-20T00:00:00.000Z";
const candidate = {
  id: catalogId,
  catalog_product_id: catalogId,
  brand_name: "CeraVe",
  product_name: "Daily SPF",
  variant_name: null,
  barcode: "12345678",
  category: "skincare" as const,
  subcategory: "sun_care" as const,
  product_type: "sunscreen" as const,
  catalog_confidence: 95,
};
const linkedRow = {
  id: ownedProductId,
  user_id: "user-a",
  product_id: productId,
  status: "unopened",
  purchase_date: null,
  opened_at: null,
  expires_on: null,
  quantity_remaining_percent: 100,
  notes: null,
  archived_at: null,
  created_at: timestamp,
  updated_at: timestamp,
  product: {
    id: productId,
    brand_name: candidate.brand_name,
    product_name: candidate.product_name,
    variant_name: candidate.variant_name,
    barcode: candidate.barcode,
    identity_status: "matched",
    category: candidate.category,
    subcategory: candidate.subcategory,
    product_type: candidate.product_type,
    catalog_product_id: catalogId,
    created_by_user_id: "user-a",
    created_at: timestamp,
    updated_at: timestamp,
  },
};

function input(
  resolutionKind: "catalog" | "external" | "unknown" = "catalog",
  catalogProductId: string | null = resolutionKind === "catalog" ? catalogId : null,
) {
  return {
    resolution_kind: resolutionKind,
    brand_name: " CeraVe ",
    product_name: "Daily-SPF",
    variant_name: "50 ml",
    barcode: null,
    category: "skincare",
    product_type: "serum",
    catalog_product_id: catalogProductId,
    status: "unopened",
    purchase_date: null,
    opened_at: null,
    expires_on: null,
    quantity_remaining_percent: 100,
    notes: null,
    idempotency_key: "40000000-0000-4000-8000-000000000001",
  };
}

function setup() {
  const matcher: ProductIdentityMatcher = {
    match: vi.fn().mockResolvedValue({
      status: "candidate",
      candidates: [candidate],
      confidence: 90,
      match_reason: "normalized_name_exact",
    }),
  };
  const repository: OwnedProductIdentityRepository = {
    create: vi.fn().mockResolvedValue(linkedRow),
  };
  const confirmedCatalogCandidates: ConfirmedCatalogCandidateRepository = {
    findOrCreate: vi.fn().mockResolvedValue({ catalogProductId: catalogId, created: true }),
  };
  return {
    matcher,
    repository,
    confirmedCatalogCandidates,
    service: createOwnedProductWithIdentityService(matcher, repository, confirmedCatalogCandidates),
  };
}

describe("CreateOwnedProductWithIdentity", () => {
  it("revalidates and creates a catalog-linked owned product", async () => {
    const { matcher, repository, service } = setup();

    const result = await service.create("user-a", input());

    expect(matcher.match).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_name: "CeraVe",
        product_name: "Daily-SPF",
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ catalog_product_id: catalogId }),
    );
    expect(result.product.catalog_product_id).toBe(catalogId);
  });

  it("returns the linked Catalog image immediately after a successful save", async () => {
    const { repository, service } = setup();
    vi.mocked(repository.create).mockResolvedValue({
      ...linkedRow,
      product: {
        ...linkedRow.product,
        catalog_product: { catalog_image_url: "https://catalog.example/serum.jpg" },
      },
    });

    const result = await service.create("user-a", input());

    expect(result.product.catalog_image_url).toBe("https://catalog.example/serum.jpg");
    expect(result.image).toEqual({
      resolved_url: "https://catalog.example/serum.jpg",
      source: "catalog",
      has_override: false,
    });
  });

  it("does not schedule research when linking an existing Catalog product", async () => {
    const { matcher, repository, confirmedCatalogCandidates } = setup();
    const schedule = vi.fn();
    const service = createOwnedProductWithIdentityService(matcher, repository, confirmedCatalogCandidates, schedule);

    await expect(service.create("user-a", input())).resolves.toMatchObject({ id: ownedProductId });
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("schedules research for an externally discovered identity after the asset write", async () => {
    const { matcher, repository, confirmedCatalogCandidates } = setup();
    const schedule = vi.fn(() => { throw new Error("background unavailable"); });
    const service = createOwnedProductWithIdentityService(matcher, repository, confirmedCatalogCandidates, schedule);

    const confirmation = issueRecognitionConfirmationToken("user-a", {
      brand_name: "CeraVe",
      product_name: "Daily-SPF",
      variant_name: "50 ml",
      barcode: null,
      product_type: "serum",
      discovery_metadata: { aliases: [], confidence: 80, sources: [], uncertainties: [] },
    });
    await expect(service.create("user-a", {
      ...input("external"),
      confirmation_token: confirmation.confirmation_token,
      idempotency_key: confirmation.confirmation_id,
    })).resolves.toMatchObject({ id: ownedProductId });
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      catalog_product_id: catalogId,
      brand_name: "CeraVe",
      product_name: "Daily-SPF",
    }), true);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repository.create).mock.invocationCallOrder[0]).toBeLessThan(schedule.mock.invocationCallOrder[0]!);
  });

  it("persists a confirmed external identity without requiring a catalog match", async () => {
    const { matcher, repository, confirmedCatalogCandidates, service } = setup();
    const confirmation = issueRecognitionConfirmationToken("user-a", {
      brand_name: "Manual Brand",
      product_name: "Manual Serum",
      variant_name: "30 ml",
      barcode: "87654321",
      product_type: "serum",
      image_url: "https://products.example/manual-serum.jpg",
      image_source_url: "https://products.example/manual-serum",
      discovery_metadata: { aliases: ["Manual alias"], confidence: 88, sources: [{ url: "https://products.example/manual-serum", title: "Product", source_type: "official" }], uncertainties: ["No ingredient research"] },
    }, Date.now(), {
      original_brand_name: "Manual Brand",
      original_product_name: "Manual Serum clue",
    });
    vi.mocked(repository.create).mockResolvedValue({
      ...linkedRow,
      asset_category: "cleansing",
      package_size: "50ml",
      manufacture_date: "2026-01-02",
      product: {
        ...linkedRow.product,
        brand_name: "Manual Brand",
        product_name: "Manual Serum",
        variant_name: "30 ml",
        barcode: "87654321",
        identity_status: "matched",
        product_type: "serum",
        subcategory: "face_care",
        catalog_product_id: catalogId,
      },
    });
    const result = await service.create("user-a", {
      ...input("external"),
      asset_category: "cleansing",
      package_size: "50ml",
      manufacture_date: "2026-01-02",
      brand_name: "Manual Brand",
      product_name: "Manual Serum",
      variant_name: "30 ml",
      barcode: "87654321",
      confirmation_token: confirmation.confirmation_token,
      idempotency_key: confirmation.confirmation_id,
    });

    expect(matcher.match).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        resolution_kind: "external",
        catalog_product_id: catalogId,
        variant_name: "30 ml",
        barcode: "87654321",
        asset_category: "cleansing",
        package_size: "50ml",
        manufacture_date: "2026-01-02",
        subcategory: "face_care",
      }),
    );
    expect(confirmedCatalogCandidates.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      confidence: 88,
      product_name: "Manual Serum",
      aliases: ["Manual alias"],
      original_identity: {
        brand_name: "Manual Brand",
        product_name: "Manual Serum clue",
      },
    }));
    expect(result.product.identity_status).toBe("matched");
    expect(result.product.catalog_product_id).toBe(catalogId);
    expect(result.asset_category).toBe("cleansing");
    expect(result.package_size).toBe("50ml");
    expect(result.manufacture_date).toBe("2026-01-02");
    expect(result.product).not.toHaveProperty("asset_category");
    expect(result.product).not.toHaveProperty("package_size");
    expect(result.product).not.toHaveProperty("manufacture_date");
  });

  it("does not persist a weak third-party 6.0 mention as the durable asset or Catalog variant", async () => {
    const { repository, confirmedCatalogCandidates } = setup();
    const confirmation = issueRecognitionConfirmationToken("user-a", {
      brand_name: "至本",
      product_name: "舒颜修护洁面乳",
      variant_name: "6.0舒缓版",
      barcode: null,
      product_type: "cleanser",
      discovery_metadata: {
        aliases: [],
        confidence: 82,
        sources: [{ url: "https://retailer.example/zhiben", title: "至本舒颜修护洁面乳 第六代", source_type: "电商商品页" }],
        uncertainties: ["版本未获品牌官方确认"],
      },
    });
    const service = createOwnedProductWithIdentityService(
      setup().matcher,
      repository,
      confirmedCatalogCandidates,
    );

    await service.create("user-a", {
      ...input("external"),
      brand_name: "至本",
      product_name: "舒颜修护洁面乳",
      variant_name: "6.0舒缓版",
      product_type: "cleanser",
      confirmation_token: confirmation.confirmation_token,
      idempotency_key: confirmation.confirmation_id,
    });

    expect(confirmedCatalogCandidates.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      variant_name: "6.0舒缓版",
      variant_evidence: null,
    }));
    expect(repository.create).toHaveBeenCalledWith("user-a", expect.objectContaining({ variant_name: null }));
  });

  it("persists an unconfirmed product as unknown identity", async () => {
    const { matcher, repository, service } = setup();
    vi.mocked(repository.create).mockResolvedValue({
      ...linkedRow,
      product: {
        ...linkedRow.product,
        catalog_product_id: null,
        identity_status: "unknown",
      },
    });

    const result = await service.create("user-a", input("unknown"));

    expect(matcher.match).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        resolution_kind: "unknown",
        catalog_product_id: null,
      }),
    );
    expect(result.product.identity_status).toBe("unknown");
  });

  it("does not create a Catalog candidate before external confirmation validates", async () => {
    const { confirmedCatalogCandidates, service } = setup();
    await expect(service.create("user-a", { ...input("external"), confirmation_token: "x".repeat(32) })).rejects.toThrow();
    expect(confirmedCatalogCandidates.findOrCreate).not.toHaveBeenCalled();
  });

  it("rejects a catalog id that is not exposed by the verified matcher", async () => {
    const { matcher, repository, service } = setup();
    vi.mocked(matcher.match).mockResolvedValue({
      status: "no_match",
      candidates: [],
      confidence: null,
      match_reason: null,
    });

    await expect(service.create("user-a", input())).rejects.toEqual(
      new CatalogIdentityMismatchError(),
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects a forged catalog id even when another verified candidate matches", async () => {
    const forgedCatalogId = "20000000-0000-4000-8000-000000000099";
    const { repository, service } = setup();

    await expect(
      service.create("user-a", input("catalog", forgedCatalogId)),
    ).rejects.toEqual(new CatalogIdentityMismatchError());
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("accepts incorrect user type for a linked candidate and returns catalog type", async () => {
    const { service } = setup();

    const result = await service.create("user-a", {
      ...input(),
      category: "makeup",
      product_type: "foundation",
    });

    expect(result.product.category).toBe("skincare");
    expect(result.product.product_type).toBe("sunscreen");
  });

  it("propagates the single transaction failure without a fallback write", async () => {
    const { repository, service } = setup();
    vi.mocked(repository.create).mockRejectedValue(new Error("DB_FAILED"));

    await expect(service.create("user-a", input())).rejects.toThrow("DB_FAILED");
    expect(repository.create).toHaveBeenCalledTimes(1);
  });
});
