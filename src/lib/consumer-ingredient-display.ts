/**
 * A display-only projection for generation-time ingredient mentions.  It is
 * deliberately separate from ingredient normalization and safety: callers
 * must never use this output to make an eligibility or contraindication
 * decision.
 */
const chineseNames: Record<string, string> = {
  "sodium lauroyl glycinate": "月桂酰甘氨酸钠",
  "decyl glucoside": "癸基葡糖苷",
  "stearyl alcohol": "硬脂醇",
  "myristic acid": "肉豆蔻酸",
  "palmitic acid": "棕榈酸",
  "stearic acid": "硬脂酸",
  "glycerin": "甘油",
  "propanediol": "1,3-丙二醇",
  "niacinamide": "烟酰胺",
  "sodium hyaluronate": "透明质酸钠",
  "hydroxyasiaticoside": "羟基积雪草苷",
  "ceramide np": "神经酰胺 NP",
  "squalane": "角鲨烷",
};

const unhelpfulBases = new Set([
  "water", "aqua", "水", "propanediol", "1,3-丙二醇",
  "myristic acid", "肉豆蔻酸", "palmitic acid", "棕榈酸",
  "stearic acid", "硬脂酸",
]);

/** Returns a concise Chinese name only when it is safe and useful to show. */
export function consumerIngredientDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  if (unhelpfulBases.has(key)) return null;
  if (/^[\u3400-\u9fff\d\s,，.()（）+\-]+$/u.test(trimmed)) return trimmed;
  return chineseNames[key] ?? null;
}

export function consumerIngredientDisplayNames(names: readonly string[], limit = 2): string[] {
  return [...new Set(names.map(consumerIngredientDisplayName).filter((name): name is string => name !== null))].slice(0, limit);
}
