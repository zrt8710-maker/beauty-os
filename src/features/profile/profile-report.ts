import type { Profile } from "@/schemas/profile";

export const skinTypeLabels: Record<
  NonNullable<Profile["skin_type"]>,
  string
> = {
  dry: "干性肌肤",
  oily: "油性肌肤",
  combination: "混合性肌肤",
  normal: "中性肌肤",
  unknown: "肤质暂不确定",
};

export const sensitivityLabels = [
  "不易敏感",
  "偶尔敏感",
  "轻度敏感",
  "明显敏感",
  "高度敏感",
] as const;

export const skinGoalLabels: Record<Profile["skin_goals"][number], string> = {
  hydration: "补水保湿",
  barrier_support: "屏障维护",
  oil_control: "控油",
  blemish_care: "痘痘护理",
  redness_relief: "舒缓泛红",
  brightening: "提亮",
  dark_spots: "淡化色沉",
  anti_aging: "抗老",
};

export const textureLabels: Record<
  Profile["texture_preferences"][number],
  string
> = {
  lightweight: "轻薄",
  rich: "滋润",
  gel: "啫喱",
  cream: "面霜",
  lotion: "乳液",
  oil: "油类",
};

export type ProfileReport = {
  overview: {
    skinType: string;
    sensitivity: string;
    goals: string[];
  };
  carePriorities: string[];
  preferenceSummary: {
    routine: string;
    textures: string;
    avoidIngredients: string;
  };
};

const skinTypePriorities: Record<
  NonNullable<Profile["skin_type"]>,
  string
> = {
  dry: "保持稳定的补水保湿节奏，留意清洁后的紧绷感。",
  oily: "关注油脂平衡，避免为了追求清爽感而过度清洁。",
  combination: "分区关注出油与干燥表现，让不同区域保持舒适。",
  normal: "维持稳定、简洁的日常护理节奏。",
  unknown: "继续记录日常皮肤表现，后续可随时补充肤质。",
};

const goalPriorities: Record<Profile["skin_goals"][number], string> = {
  hydration: "把补水保湿作为基础步骤，关注使用后的舒适度。",
  barrier_support: "优先维护屏障，避免同时叠加过多高强度步骤。",
  oil_control: "在控油与保湿之间保持平衡，避免过度去脂。",
  blemish_care: "保持护理步骤温和、稳定，减少不必要的产品叠加。",
  redness_relief: "优先选择温和的护理节奏，留意容易泛红时的使用感受。",
  brightening: "在稳定基础护理的前提下安排提亮相关步骤。",
  dark_spots: "保持防晒与日常护理的连续性，耐心观察长期变化。",
  anti_aging: "优先保证保湿与防晒，再安排可长期坚持的进阶护理。",
};

export function buildProfileReport(profile: Profile): ProfileReport {
  const carePriorities = [
    profile.skin_type
      ? skinTypePriorities[profile.skin_type]
      : "继续记录日常皮肤表现，补充肤质后可获得更完整的护理提示。",
  ];

  if (profile.sensitivity_level >= 3) {
    carePriorities.push("减少刺激性步骤，优先维护皮肤的稳定与舒适。");
  } else if (profile.sensitivity_level >= 1) {
    carePriorities.push("留意换季或更换产品时的使用感受，循序调整护理步骤。");
  }

  carePriorities.push(
    ...profile.skin_goals.map((goal) => goalPriorities[goal]),
  );

  return {
    overview: {
      skinType: profile.skin_type
        ? skinTypeLabels[profile.skin_type]
        : "肤质待补充",
      sensitivity: sensitivityLabels[profile.sensitivity_level],
      goals: profile.skin_goals.map((goal) => skinGoalLabels[goal]),
    },
    carePriorities: [...new Set(carePriorities)],
    preferenceSummary: {
      routine: `早间最多 ${profile.preferred_routine_length.am_steps} 步，晚间最多 ${profile.preferred_routine_length.pm_steps} 步`,
      textures:
        profile.texture_preferences.length > 0
          ? profile.texture_preferences
              .map((texture) => textureLabels[texture])
              .join("、")
          : "未设置质地偏好",
      avoidIngredients:
        profile.avoid_ingredients.length > 0
          ? profile.avoid_ingredients.join("、")
          : "暂无主动填写的避用成分",
    },
  };
}
