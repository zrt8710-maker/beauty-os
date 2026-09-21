import type { Profile } from "@/schemas/profile";

type SkinType = NonNullable<Profile["skin_type"]>;

export const baselineOptions: Array<{ value: SkinType; label: string }> = [
  { value: "dry", label: "偏干" },
  { value: "oily", label: "偏油" },
  { value: "combination", label: "混合" },
  { value: "normal", label: "比较均衡" },
  { value: "unknown", label: "不确定" },
];

export const sensitivityTendencyOptions = [
  { value: 0, label: "基本不会" },
  { value: 1, label: "偶尔会" },
  { value: 2, label: "比较容易" },
  { value: 3, label: "经常出现" },
  { value: 4, label: "非常容易" },
] as const;

export function baselineLabel(value: Profile["skin_type"]): string {
  return baselineOptions.find((option) => option.value === value)?.label ?? "待补充";
}

export function sensitivityTendencyLabel(value: number): string {
  return sensitivityTendencyOptions.find((option) => option.value === value)?.label ?? "待补充";
}
