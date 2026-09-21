const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export class InvalidDiscoveryBarcodeError extends Error {
  readonly code = "PRODUCT_DISCOVERY_BARCODE_INVALID";

  constructor() {
    super("PRODUCT_DISCOVERY_BARCODE_INVALID");
    this.name = "InvalidDiscoveryBarcodeError";
  }
}

export function normalizeDiscoveryBarcode(input: string): string {
  const normalized = input.trim().replace(/[\s-]+/g, "");

  if (!/^\d+$/.test(normalized) || !GTIN_LENGTHS.has(normalized.length)) {
    throw new InvalidDiscoveryBarcodeError();
  }

  const digits = [...normalized].map(Number);
  const expectedCheckDigit = digits.at(-1);
  const payload = digits.slice(0, -1);
  const sum = payload.reduce((total, digit, index) => {
    const positionFromRight = payload.length - index;
    return total + digit * (positionFromRight % 2 === 1 ? 3 : 1);
  }, 0);
  const actualCheckDigit = (10 - (sum % 10)) % 10;

  if (expectedCheckDigit !== actualCheckDigit) {
    throw new InvalidDiscoveryBarcodeError();
  }

  return normalized;
}

