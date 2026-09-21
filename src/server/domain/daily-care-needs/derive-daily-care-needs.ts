import {
  DAILY_CARE_PRIORITY_CODES,
  DAILY_CARE_RESTRICTION_CODES,
  type DailyCareLevel,
  type DailyCareNeeds,
  type DailyCareNeedsInput,
  type DailyCarePriority,
  type DailyCarePriorityCode,
  type DailyCareReason,
  type DailyCareRestriction,
  type DailyCareRestrictionCode,
  type DailyCareRole,
  type DailyCareUnknown,
} from "./types";

const HIGH_LEVEL_THRESHOLD: DailyCareLevel = 3;
const HIGH_UV_THRESHOLD = 6;

const PRIORITY_LEVEL_ORDER = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

const ROLE_ORDER: DailyCareRole[] = [
  "remover",
  "cleanser",
  "hydration",
  "treatment",
  "moisturizer",
  "sunscreen",
];

const UNKNOWN_ORDER = [
  "PROFILE_MISSING",
  "CHECKIN_MISSING",
  "WEATHER_MISSING",
  "UV_INDEX_MISSING",
  "HISTORY_MISSING",
] as const;

export function deriveDailyCareNeeds(
  input: DailyCareNeedsInput,
): DailyCareNeeds {
  const priorities = new Map<DailyCarePriorityCode, DailyCarePriority>();
  const restrictions = new Map<
    DailyCareRestrictionCode,
    DailyCareRestriction
  >();
  const reasons = new Map<string, DailyCareReason>();
  const unknowns = new Map<DailyCareUnknown["code"], DailyCareUnknown>();

  const requiredRoles = input.period === "am"
    ? (["sunscreen"] satisfies DailyCareRole[])
    : (["cleanser", "moisturizer"] satisfies DailyCareRole[]);
  const optionalRoles: DailyCareRole[] = ["hydration", "treatment"];

  addBaselineReasons(input.period, reasons);

  if (!input.profile) {
    addUnknown(unknowns, {
      code: "PROFILE_MISSING",
      impact: "缺少长期皮肤档案，无法应用长期敏感基线。",
      fallback: "仅使用当日状态、天气和基础护理角色。",
    });
  }

  if (!input.checkin) {
    addUnknown(unknowns, {
      code: "CHECKIN_MISSING",
      impact: "无法判断今天是否出现临时干燥、出油、泛红或敏感。",
      fallback: "不把缺失状态当作 0，仅使用长期档案和其他已知信息。",
    });
  }

  if (!input.weather) {
    addUnknown(unknowns, {
      code: "WEATHER_MISSING",
      impact: "无法判断今天的温度、湿度和 UV 环境。",
      fallback: "不施加任何天气加成，也不把 UV 当作 0。",
    });
  } else if (input.weather.uvIndex === null) {
    addUnknown(unknowns, {
      code: "UV_INDEX_MISSING",
      impact: "天气数据中缺少 UV 指数。",
      fallback: "不应用高 UV 规则，也不把 UV 当作 0。",
    });
  }

  if (!input.history) {
    addUnknown(unknowns, {
      code: "HISTORY_MISSING",
      impact: "缺少近期护理历史，无法提供历史趋势信号。",
      fallback: "第一版规则仅依据长期档案、当日状态和天气。",
    });
  }

  const profileSensitivity = input.profile?.sensitivityLevel;
  const checkinSensitivity = input.checkin?.sensitivityLevel;
  const knownSensitivityLevels = [
    profileSensitivity,
    checkinSensitivity,
  ].filter((level): level is DailyCareLevel => level !== undefined);
  const effectiveSensitivity = knownSensitivityLevels.length > 0
    ? Math.max(...knownSensitivityLevels)
    : null;

  if (
    profileSensitivity !== undefined
    && profileSensitivity >= HIGH_LEVEL_THRESHOLD
  ) {
    addReason(reasons, {
      code: "LONG_TERM_SENSITIVITY_HIGH",
      source: "profile",
      message: "长期敏感程度较高，今天优先采用温和的基础护理。",
    });
  }

  if (
    checkinSensitivity !== undefined
    && checkinSensitivity >= HIGH_LEVEL_THRESHOLD
  ) {
    addReason(reasons, {
      code: "TODAY_SENSITIVITY_HIGH",
      source: "checkin",
      message: "今天敏感程度较高，减少不必要的功效护理步骤。",
    });
  }

  if (
    effectiveSensitivity !== null
    && effectiveSensitivity >= HIGH_LEVEL_THRESHOLD
  ) {
    const sensitivityReasonCodes = [
      ...(profileSensitivity !== undefined
        && profileSensitivity >= HIGH_LEVEL_THRESHOLD
        ? ["LONG_TERM_SENSITIVITY_HIGH"]
        : []),
      ...(checkinSensitivity !== undefined
        && checkinSensitivity >= HIGH_LEVEL_THRESHOLD
        ? ["TODAY_SENSITIVITY_HIGH"]
        : []),
    ];

    addPriority(priorities, {
      code: "soothing",
      level: "high",
      weight: 85,
      reasonCodes: sensitivityReasonCodes,
    });
    addPriority(priorities, {
      code: "barrier_support",
      level: "high",
      weight: 80,
      reasonCodes: sensitivityReasonCodes,
    });
    addRestriction(restrictions, {
      code: "REDUCE_TREATMENT",
      severity: "hard",
      appliesToRoles: ["treatment"],
      reasonCodes: sensitivityReasonCodes,
    });
  }

  if (input.checkin?.rednessLevel !== undefined && input.checkin.rednessLevel >= HIGH_LEVEL_THRESHOLD) {
    addReason(reasons, {
      code: "TODAY_REDNESS_HIGH",
      source: "checkin",
      message: "今天泛红较明显，护理以温和和减少刺激为主。",
    });
    addPriority(priorities, {
      code: "soothing",
      level: "high",
      weight: 85,
      reasonCodes: ["TODAY_REDNESS_HIGH"],
    });
    addRestriction(restrictions, {
      code: "PREFER_GENTLE_ROUTINE",
      severity: "soft",
      appliesToRoles: [],
      reasonCodes: ["TODAY_REDNESS_HIGH"],
    });
  }

  if (input.checkin?.drynessLevel !== undefined && input.checkin.drynessLevel >= HIGH_LEVEL_THRESHOLD) {
    addReason(reasons, {
      code: "TODAY_DRYNESS_HIGH",
      source: "checkin",
      message: "今天干燥程度较高，优先关注补水和屏障维护。",
    });
    addPriority(priorities, {
      code: "hydration",
      level: "high",
      weight: 80,
      reasonCodes: ["TODAY_DRYNESS_HIGH"],
    });
    addPriority(priorities, {
      code: "barrier_support",
      level: "high",
      weight: 80,
      reasonCodes: ["TODAY_DRYNESS_HIGH"],
    });
  }

  if (input.checkin?.oilinessLevel !== undefined && input.checkin.oilinessLevel >= HIGH_LEVEL_THRESHOLD) {
    addReason(reasons, {
      code: "TODAY_OILINESS_HIGH",
      source: "checkin",
      message: "今天出油程度较高，关注油脂平衡，同时保留必要的补水方向。",
    });
    addPriority(priorities, {
      code: "oil_balance",
      level: "high",
      weight: 75,
      reasonCodes: ["TODAY_OILINESS_HIGH"],
    });
  }

  if (
    input.period === "am"
    && input.weather?.uvIndex !== null
    && input.weather?.uvIndex !== undefined
    && input.weather.uvIndex >= HIGH_UV_THRESHOLD
  ) {
    addReason(reasons, {
      code: "HIGH_UV_AM",
      source: "weather",
      message: "今天早间 UV 较高，提高防晒护理优先级。",
    });
    addPriority(priorities, {
      code: "sun_protection",
      level: "high",
      weight: 100,
      reasonCodes: ["HIGH_UV_AM"],
    });
  }

  return {
    priorities: [...priorities.values()].sort(
      (left, right) => priorityIndex(left.code) - priorityIndex(right.code),
    ),
    requiredRoles: sortRoles(requiredRoles),
    optionalRoles: sortRoles(optionalRoles),
    restrictions: [...restrictions.values()].sort(
      (left, right) => restrictionIndex(left.code) - restrictionIndex(right.code),
    ),
    reasons: [...reasons.values()],
    unknowns: [...unknowns.values()].sort(
      (left, right) => unknownIndex(left.code) - unknownIndex(right.code),
    ),
  };
}

function addBaselineReasons(
  period: DailyCareNeedsInput["period"],
  reasons: Map<string, DailyCareReason>,
) {
  if (period === "am") {
    addReason(reasons, {
      code: "AM_BASELINE_SUN_PROTECTION",
      source: "baseline",
      message: "早间基础护理保留防晒角色。",
    });
    return;
  }

  addReason(reasons, {
    code: "PM_BASELINE_CLEANSING",
    source: "baseline",
    message: "晚间基础护理保留清洁角色。",
  });
  addReason(reasons, {
    code: "PM_BASELINE_MOISTURIZING",
    source: "baseline",
    message: "晚间基础护理保留保湿角色。",
  });
}

function addPriority(
  priorities: Map<DailyCarePriorityCode, DailyCarePriority>,
  priority: DailyCarePriority,
) {
  const current = priorities.get(priority.code);
  if (!current) {
    priorities.set(priority.code, {
      ...priority,
      reasonCodes: [...priority.reasonCodes],
    });
    return;
  }

  priorities.set(priority.code, {
    code: priority.code,
    level: PRIORITY_LEVEL_ORDER[priority.level]
      > PRIORITY_LEVEL_ORDER[current.level]
      ? priority.level
      : current.level,
    weight: Math.max(current.weight, priority.weight),
    reasonCodes: unique([...current.reasonCodes, ...priority.reasonCodes]),
  });
}

function addRestriction(
  restrictions: Map<DailyCareRestrictionCode, DailyCareRestriction>,
  restriction: DailyCareRestriction,
) {
  const current = restrictions.get(restriction.code);
  if (!current) {
    restrictions.set(restriction.code, {
      ...restriction,
      appliesToRoles: [...restriction.appliesToRoles],
      reasonCodes: [...restriction.reasonCodes],
    });
    return;
  }

  restrictions.set(restriction.code, {
    code: restriction.code,
    severity: current.severity === "hard" || restriction.severity === "hard"
      ? "hard"
      : "soft",
    appliesToRoles: sortRoles([
      ...current.appliesToRoles,
      ...restriction.appliesToRoles,
    ]),
    reasonCodes: unique([...current.reasonCodes, ...restriction.reasonCodes]),
  });
}

function addReason(
  reasons: Map<string, DailyCareReason>,
  reason: DailyCareReason,
) {
  if (!reasons.has(reason.code)) reasons.set(reason.code, reason);
}

function addUnknown(
  unknowns: Map<DailyCareUnknown["code"], DailyCareUnknown>,
  unknown: DailyCareUnknown,
) {
  if (!unknowns.has(unknown.code)) unknowns.set(unknown.code, unknown);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sortRoles(roles: DailyCareRole[]): DailyCareRole[] {
  return unique(roles).sort(
    (left, right) => ROLE_ORDER.indexOf(left) - ROLE_ORDER.indexOf(right),
  );
}

function priorityIndex(code: DailyCarePriorityCode) {
  return DAILY_CARE_PRIORITY_CODES.indexOf(code);
}

function restrictionIndex(code: DailyCareRestrictionCode) {
  return DAILY_CARE_RESTRICTION_CODES.indexOf(code);
}

function unknownIndex(code: DailyCareUnknown["code"]) {
  return UNKNOWN_ORDER.indexOf(code);
}
