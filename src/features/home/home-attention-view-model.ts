import { presentProfileSuggestion } from "@/features/profile/profile-suggestion-presentation";
import type { InventoryQuantityAttention } from "@/features/home/inventory-quantity-attention";
import type { OwnedProduct } from "@/schemas/product";
import type { SkinProfileSuggestion } from "@/server/services/skin-profile-suggestion-service";

export type HomeAttentionItem = {
  id: string;
  kind: "asset_expired" | "asset_expiring_soon" | "inventory_quantity_check" | "profile_suggestion";
  priority: number;
  title: string;
  description: string;
  actionLabel: string;
  href: string;
  quantityCheck?: InventoryQuantityAttention;
};

type AttentionOwnedProduct = Pick<
  OwnedProduct,
  "id" | "status" | "expires_on" | "quantity_remaining_percent"
> & {
  product: Pick<OwnedProduct["product"], "brand_name" | "product_name">;
};

type BuildHomeAttentionItemsInput = {
  today: string;
  ownedProducts: AttentionOwnedProduct[];
  profileSuggestions: SkinProfileSuggestion[];
  quantityAttention?: InventoryQuantityAttention | null;
};

const excludedStatuses = new Set<OwnedProduct["status"]>([
  "archived",
  "finished",
  "discarded",
]);

export function buildHomeAttentionItems({
  today,
  ownedProducts,
  profileSuggestions,
  quantityAttention = null,
}: BuildHomeAttentionItemsInput): HomeAttentionItem[] {
  const assetItem = buildAssetAttention(today, ownedProducts);
  const quantityItem = buildQuantityAttention(quantityAttention);
  const profileItem = buildProfileAttention(profileSuggestions[0]);

  return [assetItem, quantityItem, profileItem]
    .filter((item): item is HomeAttentionItem => item !== null)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

function buildQuantityAttention(
  attention: InventoryQuantityAttention | null,
): HomeAttentionItem | null {
  if (!attention) return null;
  return {
    id: `inventory-quantity-check:${attention.owned_product_id}`,
    kind: "inventory_quantity_check",
    priority: 150,
    title: "要不要更新一下余量？",
    description: `最近常用的「${attention.product_display_name}」，当前记录的余量可能需要更新。`,
    actionLabel: "检查余量",
    href: "/inventory",
    quantityCheck: attention,
  };
}

function buildAssetAttention(
  today: string,
  ownedProducts: AttentionOwnedProduct[],
): HomeAttentionItem | null {
  const eligible = ownedProducts
    .filter((item) => (
      item.expires_on !== null
      && !excludedStatuses.has(item.status)
      && item.quantity_remaining_percent > 0
    ))
    .map((item) => ({ item, days: differenceInCalendarDays(item.expires_on!, today) }))
    .filter(({ days }) => days <= 30);

  const expired = eligible.filter(({ days }) => days < 0);
  if (expired.length) {
    return assetAttention({
      id: "asset-expired",
      priority: 400,
      title: "有产品已经到期",
      description: expired.length === 1
        ? `${productName(expired[0].item)}已到期。`
        : `你有 ${expired.length} 件产品已经到期。`,
      kind: "asset_expired",
    });
  }

  const withinSevenDays = eligible.filter(({ days }) => days >= 0 && days <= 7);
  if (withinSevenDays.length) {
    return assetAttention({
      id: "asset-expiring-seven-days",
      priority: 300,
      title: "有产品快到期了",
      description: withinSevenDays.length === 1
        ? describeSingleExpiry(withinSevenDays[0].item, withinSevenDays[0].days)
        : `你有 ${withinSevenDays.length} 件产品将在 7 天内到期。`,
      kind: "asset_expiring_soon",
    });
  }

  const withinThirtyDays = eligible.filter(({ days }) => days > 7 && days <= 30);
  if (withinThirtyDays.length) {
    return assetAttention({
      id: "asset-expiring-thirty-days",
      priority: 200,
      title: "有产品进入临期阶段",
      description: withinThirtyDays.length === 1
        ? describeSingleExpiry(withinThirtyDays[0].item, withinThirtyDays[0].days)
        : `你有 ${withinThirtyDays.length} 件产品将在 30 天内到期。`,
      kind: "asset_expiring_soon",
    });
  }

  return null;
}

function buildProfileAttention(
  suggestion: SkinProfileSuggestion | undefined,
): HomeAttentionItem | null {
  if (!suggestion) return null;
  const presentation = presentProfileSuggestion(suggestion);
  return {
    id: `profile-suggestion:${suggestion.id}`,
    kind: "profile_suggestion",
    priority: 100,
    title: "长期皮肤档案有一条更新建议",
    description: presentation.lead,
    actionLabel: "看看建议",
    href: presentation.href,
  };
}

function assetAttention(
  input: Pick<HomeAttentionItem, "id" | "kind" | "priority" | "title" | "description">,
): HomeAttentionItem {
  return {
    ...input,
    actionLabel: "查看资产",
    href: "/inventory",
  };
}

function describeSingleExpiry(item: AttentionOwnedProduct, days: number) {
  return days === 0
    ? `${productName(item)}今天到期。`
    : `${productName(item)}还有 ${days} 天到期。`;
}

function productName(item: AttentionOwnedProduct) {
  return [item.product.brand_name, item.product.product_name]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function differenceInCalendarDays(date: string, today: string) {
  return Math.round((dateAtUtcMidnight(date) - dateAtUtcMidnight(today)) / 86_400_000);
}

function dateAtUtcMidnight(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}
