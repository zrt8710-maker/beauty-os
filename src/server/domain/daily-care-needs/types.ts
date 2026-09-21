export const DAILY_CARE_PERIODS = ["am", "pm"] as const;

export const DAILY_CARE_SKIN_TYPES = [
  "dry",
  "oily",
  "combination",
  "normal",
  "unknown",
] as const;

export const DAILY_CARE_GOALS = [
  "hydration",
  "barrier_support",
  "oil_control",
  "blemish_care",
  "redness_relief",
  "brightening",
  "dark_spots",
  "anti_aging",
] as const;

export const DAILY_CARE_PRIORITY_CODES = [
  "hydration",
  "barrier_support",
  "oil_balance",
  "soothing",
  "reduce_irritation",
  "sun_protection",
] as const;

export const DAILY_CARE_ROLES = [
  "remover",
  "cleanser",
  "hydration",
  "treatment",
  "moisturizer",
  "sunscreen",
] as const;

export const DAILY_CARE_RESTRICTION_CODES = [
  "REDUCE_TREATMENT",
  "LIMIT_LAYERING",
  "AVOID_HEAVY_OIL",
  "PREFER_GENTLE_ROUTINE",
] as const;

export const DAILY_CARE_REASON_SOURCES = [
  "baseline",
  "profile",
  "checkin",
  "weather",
  "history",
] as const;

export const DAILY_CARE_UNKNOWN_CODES = [
  "PROFILE_MISSING",
  "CHECKIN_MISSING",
  "WEATHER_MISSING",
  "UV_INDEX_MISSING",
  "HISTORY_MISSING",
] as const;

export type DailyCarePeriod = (typeof DAILY_CARE_PERIODS)[number];
export type DailyCareSkinType = (typeof DAILY_CARE_SKIN_TYPES)[number];
export type DailyCareGoal = (typeof DAILY_CARE_GOALS)[number];
export type DailyCarePriorityCode =
  (typeof DAILY_CARE_PRIORITY_CODES)[number];
export type DailyCareRole = (typeof DAILY_CARE_ROLES)[number];
export type DailyCareRestrictionCode =
  (typeof DAILY_CARE_RESTRICTION_CODES)[number];
export type DailyCareReasonSource =
  (typeof DAILY_CARE_REASON_SOURCES)[number];
export type DailyCareUnknownCode =
  (typeof DAILY_CARE_UNKNOWN_CODES)[number];
export type DailyCareLevel = 0 | 1 | 2 | 3 | 4;

export type DailyCareNeedsProfile = {
  skinType: DailyCareSkinType | null;
  sensitivityLevel: DailyCareLevel;
  goals: DailyCareGoal[];
  avoidIngredients: string[];
  maxSteps: number;
};

export type DailyCareNeedsCheckin = {
  drynessLevel?: DailyCareLevel;
  oilinessLevel?: DailyCareLevel;
  sensitivityLevel?: DailyCareLevel;
  rednessLevel?: DailyCareLevel;
  acneLevel?: DailyCareLevel;
};

export type DailyCareNeedsWeather = {
  temperature: number | null;
  humidity: number | null;
  uvIndex: number | null;
};

export type DailyCareNeedsHistory = {
  recentHighReactionCount: number;
  repeatedDrynessDays: number;
  repeatedRednessDays: number;
};

export type DailyCareNeedsInput = {
  routineDate: string;
  period: DailyCarePeriod;
  profile: DailyCareNeedsProfile | null;
  checkin: DailyCareNeedsCheckin | null;
  weather: DailyCareNeedsWeather | null;
  history: DailyCareNeedsHistory | null;
};

export type DailyCarePriority = {
  code: DailyCarePriorityCode;
  level: "low" | "medium" | "high";
  weight: number;
  reasonCodes: string[];
};

export type DailyCareRestriction = {
  code: DailyCareRestrictionCode;
  severity: "hard" | "soft";
  appliesToRoles: DailyCareRole[];
  reasonCodes: string[];
};

export type DailyCareReason = {
  code: string;
  source: DailyCareReasonSource;
  message: string;
};

export type DailyCareUnknown = {
  code: DailyCareUnknownCode;
  impact: string;
  fallback: string;
};

export type DailyCareNeeds = {
  priorities: DailyCarePriority[];
  requiredRoles: DailyCareRole[];
  optionalRoles: DailyCareRole[];
  restrictions: DailyCareRestriction[];
  reasons: DailyCareReason[];
  unknowns: DailyCareUnknown[];
};
