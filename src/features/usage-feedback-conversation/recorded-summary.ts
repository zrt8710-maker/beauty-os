import type { UsageFeedbackRecordedSummary } from "@/schemas/usage-feedback-conversation";
import type { UsageHistory } from "@/schemas/usage";

/** A consumer-safe projection of the usage record returned after a successful write. */
export function buildRecordedFeedbackSummary(history: UsageHistory, productNames: ReadonlyMap<string, string>): UsageFeedbackRecordedSummary {
  return {
    outcome: history.completion_status === "skipped" ? "routine_skipped" : "routine_used",
    products: history.products.flatMap((product) => {
      const productName = productNames.get(product.owned_product_id);
      if (!productName) return [];
      return [{ product_name: productName, observations: productObservations(product) }];
    }),
    overall_note: history.notes,
  };
}

function productObservations(product: UsageHistory["products"][number]) {
  return [...new Set([
    ratingSummary(product.rating),
    ...textureSummaries(product.texture_feedback),
    ...reactionSummaries(product.reaction_tags, product.reaction_level),
    product.notes,
  ].filter((value): value is string => Boolean(value)))];
}

function ratingSummary(rating: number | null) {
  if (rating === null) return null;
  if (rating >= 4) return "使用感不错";
  if (rating <= 2) return "使用感不太适合";
  return "使用感一般";
}

function textureSummaries(value: string | null) {
  const labels: Record<string, string> = {
    too_oily: "偏油",
    too_sticky: "偏黏",
    pilling: "有搓泥感",
    not_hydrating_enough: "保湿感不够",
    comfortable: "肤感舒服",
  };
  return (value?.split(",") ?? []).flatMap((tag) => labels[tag.trim()] ? [labels[tag.trim()]] : []);
}

function reactionSummaries(tags: string[], level: number | null) {
  const labels: Record<string, string> = { stinging: "有刺痛感", redness: "有泛红", breakout: "有闷痘或爆痘" };
  const known = tags.flatMap((tag) => labels[tag] ? [labels[tag]] : []);
  return known.length || (level ?? 0) < 2 ? known : [...known, "有不适感"];
}
