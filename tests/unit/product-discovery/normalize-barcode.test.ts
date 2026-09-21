import { describe, expect, it } from "vitest";

import {
  InvalidDiscoveryBarcodeError,
  normalizeDiscoveryBarcode,
} from "@/server/domain/product-discovery";

describe("normalizeDiscoveryBarcode", () => {
  it.each([
    ["96385074", "96385074"],
    ["036000291452", "036000291452"],
    ["4006 3813 3393 1", "4006381333931"],
    ["1-0012345-00001-7", "10012345000017"],
  ])("normalizes and validates supported GTIN shapes", (input, expected) => {
    expect(normalizeDiscoveryBarcode(input)).toBe(expected);
  });

  it.each([
    "1234567",
    "123456789",
    "4006381333932",
    "ABC4006381333931",
    "",
  ])("rejects invalid length, characters, or check digit", (input) => {
    expect(() => normalizeDiscoveryBarcode(input)).toThrow(
      InvalidDiscoveryBarcodeError,
    );
  });
});

