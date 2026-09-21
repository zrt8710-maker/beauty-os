import type { SkinCheckin, SkinCheckinField } from "@/schemas/checkin";

export const SKIN_STATUS_FIELDS = [
  { key: "dryness_level", label: "干燥" },
  { key: "oiliness_level", label: "出油" },
  { key: "redness_level", label: "泛红" },
  { key: "sensitivity_level", label: "敏感" },
  { key: "acne_level", label: "痘痘" },
] as const satisfies ReadonlyArray<{
  key: SkinStatusKey;
  label: string;
}>;

export const SKIN_LEVEL_LABELS = [
  "无",
  "轻微",
  "一般",
  "明显",
  "严重",
] as const;

export type SkinStatusKey = keyof Pick<
  SkinCheckin,
  | "dryness_level"
  | "oiliness_level"
  | "redness_level"
  | "sensitivity_level"
  | "acne_level"
>;

export type SkinStatusValues = Pick<SkinCheckin, SkinStatusKey>;

export function isSkinFieldKnown(
  status: Pick<SkinCheckin, "known_fields">,
  field: SkinCheckinField,
) {
  return status.known_fields.includes(field);
}

export function formatSkinLevel(level: number): string {
  return SKIN_LEVEL_LABELS[level] ?? "未知";
}

export function getSkinStatusSummary(
  status: SkinStatusValues & Pick<SkinCheckin, "known_fields">,
): string | null {
  const activeStatuses = SKIN_STATUS_FIELDS.map((field, index) => ({
    index,
    label: field.label,
    level: status[field.key],
  }))
    .filter((item) => isSkinFieldKnown(status, SKIN_STATUS_FIELDS[item.index].key))
    .filter((item) => item.level > 0)
    .sort((a, b) => b.level - a.level || a.index - b.index)
    .slice(0, 2);

  if (activeStatuses.length === 0) {
    return status.known_fields.length > 0 ? "状态稳定" : null;
  }

  return activeStatuses
    .map((item) => `${item.label}${formatSkinLevel(item.level)}`)
    .join(" · ");
}
