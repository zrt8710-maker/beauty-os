import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import type { ProductKnowledgeCurationInput } from "@/schemas/product-knowledge-curation";
import { createProductKnowledgeCurationRepository } from "@/server/repositories/product-knowledge-curation-repository";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const roleAssignmentId = "20000000-0000-4000-8000-000000000001";
const capabilityAssignmentId = "30000000-0000-4000-8000-000000000001";

const input: ProductKnowledgeCurationInput = {
  schema_version: "product-knowledge-curation/v0.1",
  catalog_product_id: catalogProductId,
  roles: [
    {
      care_role_code: "moisturizer",
      assignment_kind: "primary",
      status: "verified",
      confidence: 95,
      assessment_note: "Primary moisturizing step.",
      source_locator: "official-product-page",
      reviewed_at: "2026-08-24T00:00:00.000Z",
    },
  ],
  capabilities: [
    {
      capability_code: "hydration",
      status: "verified",
      confidence: 90,
      assessment_note: "Supports hydration.",
      reviewed_at: "2026-08-24T00:00:00.000Z",
      evidence: [
        {
          evidence_type: "official_product_description",
          direction: "supports",
          evidence_note: "Official description supports hydration.",
          source_locator: "official-product-page",
          confidence: 95,
          review_status: "verified",
        },
      ],
    },
  ],
};

const receipt = {
  catalog_product_id: catalogProductId,
  role_assignment_ids: { moisturizer: roleAssignmentId },
  capability_assignment_ids: { hydration: capabilityAssignmentId },
  evidence_counts: { hydration: 1 },
};

describe("ProductKnowledgeCurationRepository", () => {
  it("applies the complete curation input through exactly one RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    const from = vi.fn();
    const repository = createProductKnowledgeCurationRepository({
      rpc,
      from,
    } as unknown as SupabaseClient<Database>);

    await expect(repository.applyAtomically(input)).resolves.toEqual(receipt);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "apply_product_knowledge_curation_v01",
      { p_input: input },
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("throws a write error with the RPC error as its cause", async () => {
    const rpcError = { code: "P0001", message: "catalog product not found" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const repository = createProductKnowledgeCurationRepository({
      rpc,
    } as unknown as SupabaseClient<Database>);

    let thrown: unknown;
    try {
      await repository.applyAtomically(input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      "PRODUCT_KNOWLEDGE_CURATION_WRITE_FAILED",
    );
    expect((thrown as Error).cause).toBe(rpcError);
  });

  it("strictly rejects an invalid RPC receipt and preserves the parse error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...receipt, unexpected: true },
      error: null,
    });
    const repository = createProductKnowledgeCurationRepository({
      rpc,
    } as unknown as SupabaseClient<Database>);

    let thrown: unknown;
    try {
      await repository.applyAtomically(input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      "PRODUCT_KNOWLEDGE_CURATION_RECEIPT_INVALID",
    );
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });
});
