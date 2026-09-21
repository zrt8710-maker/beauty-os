import type { OwnedProduct } from "@/schemas/product";
import type { QuantityUsageRecord } from "@/server/repositories/usage-repository";

export type InventoryQuantityAttention = {
  owned_product_id: string;
  product_display_name: string;
  current_recorded_quantity: number;
  reason: "recent_usage_quantity_check";
};

type QuantityAttentionOwnedProduct = Pick<
  OwnedProduct,
  "id" | "status" | "archived_at" | "quantity_remaining_percent" | "updated_at"
> & {
  product: Pick<OwnedProduct["product"], "brand_name" | "product_name">;
};

export function deriveInventoryQuantityAttention({
  ownedProducts,
  recentUsage,
  timeZone,
  today,
}: {
  ownedProducts: QuantityAttentionOwnedProduct[];
  recentUsage: QuantityUsageRecord[];
  timeZone: string;
  today: string;
}): InventoryQuantityAttention | null {
  const latestAllowedDate = today;
  const earliestAllowedDate = addDays(today, -29);
  const recentCutoff = addDays(today, -7);
  const usageDatesByOwnedProduct = new Map<string, string[]>();

  for (const record of recentUsage) {
    if (record.usedDate < earliestAllowedDate || record.usedDate > latestAllowedDate) continue;
    const dates = usageDatesByOwnedProduct.get(record.ownedProductId) ?? [];
    dates.push(record.usedDate);
    usageDatesByOwnedProduct.set(record.ownedProductId, dates);
  }

  const candidates = ownedProducts.flatMap((ownedProduct) => {
    if (
      ownedProduct.status !== "active"
      || ownedProduct.archived_at !== null
      || ownedProduct.quantity_remaining_percent <= 0
    ) return [];

    // Usage only has a profile-local date. Same-day rows cannot prove they
    // happened after the timestamp, so require a strictly later local date.
    const updatedDate = dateInTimeZone(ownedProduct.updated_at, timeZone);
    const qualifyingDates = (usageDatesByOwnedProduct.get(ownedProduct.id) ?? [])
      .filter((date) => date > updatedDate)
      .sort();
    if (qualifyingDates.length < 3) return [];

    const firstUsedDate = qualifyingDates[0];
    const lastUsedDate = qualifyingDates.at(-1)!;
    if (differenceInDays(lastUsedDate, firstUsedDate) < 7 || lastUsedDate < recentCutoff) {
      return [];
    }

    return [{
      ownedProduct,
      usageCount: qualifyingDates.length,
      lastUsedDate,
    }];
  }).sort((left, right) => (
    right.usageCount - left.usageCount
    || right.lastUsedDate.localeCompare(left.lastUsedDate)
    || left.ownedProduct.id.localeCompare(right.ownedProduct.id)
  ));

  const selected = candidates[0];
  if (!selected) return null;

  return {
    owned_product_id: selected.ownedProduct.id,
    product_display_name: productName(selected.ownedProduct),
    current_recorded_quantity: selected.ownedProduct.quantity_remaining_percent,
    reason: "recent_usage_quantity_check",
  };
}

function productName(ownedProduct: QuantityAttentionOwnedProduct) {
  return [ownedProduct.product.brand_name, ownedProduct.product.product_name]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function dateInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, days: number) {
  const date = dateAtUtcMidnight(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function differenceInDays(later: string, earlier: string) {
  return Math.round(
    (dateAtUtcMidnight(later).getTime() - dateAtUtcMidnight(earlier).getTime()) / 86_400_000,
  );
}

function dateAtUtcMidnight(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
