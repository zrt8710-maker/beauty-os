import { describe, expect, it } from "vitest";

import { runDataBoundaryValidation } from "@/server/services/data-boundary-validation-service";

describe("Beauty OS data boundary validation", () => {
  const report = runDataBoundaryValidation();

  it("passes all four asset-first boundary cases", () => {
    expect(report.all_passed).toBe(true);
    expect(report.cases).toHaveLength(4);
    expect(report.cases.find(
      (item) => item.code === "CATALOG_WITHOUT_VERIFIED_KNOWLEDGE",
    )?.routine_selected).toBe(false);
  });

  it("keeps no-catalog and catalog-without-knowledge products on fallback", () => {
    expect(report.cases.find((item) => item.code === "NO_CATALOG_FALLBACK"))
      .toMatchObject({
        role: "moisturizer",
        role_source: "product_type_fallback",
        knowledge_status: "unknown",
      });
    expect(report.cases.find(
      (item) => item.code === "CATALOG_WITHOUT_VERIFIED_KNOWLEDGE",
    )).toMatchObject({
      role: "treatment",
      role_source: "product_type_fallback",
      knowledge_status: "unknown",
      routine_selected: false,
    });
  });

  it("allows only verified knowledge to override the fallback", () => {
    expect(report.cases.find(
      (item) => item.code === "VERIFIED_KNOWLEDGE_ENHANCEMENT",
    )).toMatchObject({
      role: "moisturizer",
      role_source: "verified_knowledge",
      knowledge_status: "verified",
    });
  });

  it("keeps unknown identity usable without inventing knowledge", () => {
    expect(report.cases.find(
      (item) => item.code === "UNKNOWN_IDENTITY_REMAINS_USABLE",
    )).toMatchObject({
      identity_status: "unknown",
      role: "cleanser",
      routine_selected: true,
      false_knowledge_generated: false,
    });
  });
});
