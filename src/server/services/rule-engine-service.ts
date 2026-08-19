import "server-only";

import type { Json } from "@/db/database.types";
import {
  routineGenerateSchema,
  routineIdSchema,
  routineSchema,
  type ExcludedProduct,
  type ExclusionReasonCode,
  type Routine,
  type RoutinePeriod,
  type RoutineReasonCode,
  type RoutineRole,
  type ScoreBreakdown,
} from "@/schemas/routine";
import type {
  OwnedProductRepository,
  OwnedProductWithProductRow,
} from "@/server/repositories/owned-product-repository";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type {
  RoutineRepository,
  RoutineStepWrite,
  RoutineWithStepsRow,
} from "@/server/repositories/routine-repository";
import type {
  SkinCheckinRepository,
  SkinCheckinRow,
} from "@/server/repositories/skin-checkin-repository";
import type {
  WeatherRepository,
  WeatherRow,
} from "@/server/repositories/weather-repository";
import type { UsageService } from "@/server/services/usage-service";

export class RoutineNotFoundError extends Error {
  constructor() {
    super("ROUTINE_NOT_FOUND");
    this.name = "RoutineNotFoundError";
  }
}

export type RuleEngineDependencies = {
  profiles: ProfileRepository;
  checkins: SkinCheckinRepository;
  weather: WeatherRepository;
  ownedProducts: OwnedProductRepository;
  routines: RoutineRepository;
  usage: UsageService;
  now?: () => Date;
};

export type RuleContext = {
  routineDate: string;
  period: RoutinePeriod;
  checkin: SkinCheckinRow | null;
  weather: WeatherRow | null;
  products: OwnedProductWithProductRow[];
  feedbackStats: Map<string, { usageCount: number; averageRating: number | null; highReactionCount: number }>;
  maxSteps: number;
};

export type RoutinePlan = {
  steps: RoutineStepWrite[];
  excludedProducts: ExcludedProduct[];
};

type ScoredCandidate = Omit<RoutineStepWrite, "step_order"> & {
  owned: OwnedProductWithProductRow;
};

const roleByProductType: Record<string, RoutineRole | undefined> = {
  makeup_remover: "remover",
  cleanser: "cleanser",
  toner: "hydration",
  essence: "hydration",
  serum: "treatment",
  treatment: "treatment",
  mask: "treatment",
  moisturizer: "moisturizer",
  face_oil: "moisturizer",
  sunscreen: "sunscreen",
};

const roleOrder: Record<RoutinePeriod, Partial<Record<RoutineRole, number>>> = {
  am: { cleanser: 1, hydration: 2, treatment: 2, moisturizer: 3, sunscreen: 4 },
  pm: { remover: 1, cleanser: 2, treatment: 3, moisturizer: 4 },
};

const requiredRoles: Record<RoutinePeriod, ReadonlySet<RoutineRole>> = {
  am: new Set(["moisturizer", "sunscreen"]),
  pm: new Set(["cleanser", "moisturizer"]),
};

export function buildRoutinePlan(context: RuleContext): RoutinePlan {
  const sensitive = (context.checkin?.sensitivity_level ?? 0) >= 3;
  const excludedProducts: ExcludedProduct[] = [];
  const candidates: ScoredCandidate[] = [];

  for (const owned of [...context.products].sort((a, b) => a.id.localeCompare(b.id))) {
    const exclusion = eligibilityExclusion(owned, context, sensitive);
    if (exclusion) {
      excludedProducts.push(toExcludedProduct(owned, exclusion.code, exclusion.reason));
      continue;
    }
    candidates.push(scoreProduct(owned, context, sensitive));
  }

  const selectedByRole = new Map<RoutineRole, ScoredCandidate>();
  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (!selectedByRole.has(candidate.role)) {
      selectedByRole.set(candidate.role, candidate);
      continue;
    }
    excludedProducts.push(toExcludedProduct(
      candidate.owned,
      "DUPLICATE_ROLE_REMOVED",
      `同一 ${candidate.role} 角色已有评分更高或排序更稳定的产品。`,
    ));
  }

  if (context.period === "am") {
    const hydration = selectedByRole.get("hydration");
    const treatment = selectedByRole.get("treatment");
    if (hydration && treatment) {
      const removed = compareCandidates(hydration, treatment) <= 0 ? treatment : hydration;
      selectedByRole.delete(removed.role);
      excludedProducts.push(toExcludedProduct(
        removed.owned,
        "OPTIONAL_SLOT_REPLACED",
        "早间补水/功效共用一个可选步骤，保留评分更高的产品。",
      ));
    }
  }

  let selected = [...selectedByRole.values()];
  while (selected.length > context.maxSteps) {
    const removable = [...selected].sort((a, b) => {
      const requiredDifference = Number(requiredRoles[context.period].has(a.role))
        - Number(requiredRoles[context.period].has(b.role));
      return requiredDifference || a.score - b.score || b.owned.id.localeCompare(a.owned.id);
    })[0];
    selected = selected.filter((candidate) => candidate !== removable);
    excludedProducts.push(toExcludedProduct(
      removable.owned,
      "STEP_LIMIT_REMOVED",
      `超过用户设置的 ${context.period.toUpperCase()} 最大步骤数。`,
    ));
  }

  const steps = selected
    .sort((a, b) => {
      const orderDifference = (roleOrder[context.period][a.role] ?? 99)
        - (roleOrder[context.period][b.role] ?? 99);
      return orderDifference || compareCandidates(a, b);
    })
    .map((candidate, index) => ({
      owned_product_id: candidate.owned_product_id,
      step_order: index + 1,
      role: candidate.role,
      reason: candidate.reason,
      reason_code: candidate.reason_code,
      score: candidate.score,
      score_breakdown: candidate.score_breakdown,
    }));

  return {
    steps,
    excludedProducts: excludedProducts.sort((a, b) =>
      a.owned_product_id.localeCompare(b.owned_product_id),
    ),
  };
}

export function buildRoutineSteps(context: RuleContext): RoutineStepWrite[] {
  return buildRoutinePlan(context).steps;
}

function eligibilityExclusion(
  owned: OwnedProductWithProductRow,
  context: RuleContext,
  sensitive: boolean,
): { code: ExclusionReasonCode; reason: string } | null {
  if (owned.archived_at || owned.status === "archived") {
    return { code: "PRODUCT_ARCHIVED", reason: "产品已归档。" };
  }
  if (["finished", "discarded"].includes(owned.status)) {
    return { code: "PRODUCT_FINISHED", reason: "产品已用完或已弃用。" };
  }
  if (owned.status !== "active") {
    return { code: "PRODUCT_NOT_ACTIVE", reason: "产品当前不是可使用状态。" };
  }
  if (owned.quantity_remaining_percent <= 0) {
    return { code: "PRODUCT_EMPTY", reason: "产品剩余量为 0。" };
  }
  if (owned.expires_on && owned.expires_on < context.routineDate) {
    return { code: "PRODUCT_EXPIRED", reason: "产品已超过明确填写的到期日。" };
  }
  if ((context.feedbackStats.get(owned.id)?.highReactionCount ?? 0) >= 3) {
    return {
      code: "RECENT_HIGH_REACTION_HARD_BLOCK",
      reason: "最近 30 天已记录至少 3 次高等级不适反应，暂不纳入方案。",
    };
  }
  if (owned.product.category !== "skincare") {
    return { code: "NON_SKINCARE_PRODUCT", reason: "当前只生成护肤方案。" };
  }

  const role = roleByProductType[owned.product.product_type];
  if (!role) {
    return { code: "UNSUPPORTED_PRODUCT_TYPE", reason: "当前规则没有对应的护肤步骤角色。" };
  }
  if (roleOrder[context.period][role] === undefined) {
    return {
      code: "PERIOD_NOT_APPLICABLE",
      reason: `该产品不适用于当前 ${context.period.toUpperCase()} 顺序。`,
    };
  }
  if (sensitive && role === "treatment") {
    return {
      code: "HIGH_SENSITIVITY_REDUCE_ACTIVE",
      reason: "今天敏感程度较高，减少功效护理步骤。",
    };
  }
  return null;
}

function scoreProduct(
  owned: OwnedProductWithProductRow,
  context: RuleContext,
  sensitive: boolean,
): ScoredCandidate {
  const role = roleByProductType[owned.product.product_type]!;
  const breakdown: ScoreBreakdown = {
    base: 40,
    skin_fit: 0,
    weather_fit: 0,
    feedback_score: 0,
    inventory_priority: 10,
  };
  const reasons = ["基础分 40", "当前库存可用 +10"];

  if ((context.checkin?.dryness_level ?? 0) >= 3 && role === "moisturizer") {
    breakdown.skin_fit += 15;
    reasons.push("干燥状态匹配 +15");
  }
  if (sensitive && ["hydration", "moisturizer"].includes(role)) {
    breakdown.skin_fit += 15;
    reasons.push("高敏感基础护理 +15");
  }
  if ((context.checkin?.oiliness_level ?? 0) >= 3 && role === "hydration") {
    breakdown.skin_fit += 8;
    reasons.push("出油状态轻量补水 +8");
  }
  if ((context.checkin?.acne_level ?? 0) >= 3 && role === "treatment") {
    breakdown.skin_fit += 8;
    reasons.push("当前功效护理匹配 +8");
  }

  const highUv = context.period === "am" && (context.weather?.uv_index ?? 0) >= 6;
  if (highUv && role === "sunscreen") {
    breakdown.weather_fit += 25;
    reasons.push("高 UV 防晒优先 +25");
  }
  if ((context.weather?.humidity ?? 0) >= 70 && owned.product.product_type === "face_oil") {
    breakdown.weather_fit -= 20;
    reasons.push("高湿度油类降权 -20");
  }
  if ((context.weather?.temperature ?? 100) <= 10 && role === "moisturizer") {
    breakdown.weather_fit += 8;
    reasons.push("低温保湿匹配 +8");
  }

  const feedback = context.feedbackStats.get(owned.id);
  if (feedback?.averageRating !== null && feedback?.averageRating !== undefined) {
    breakdown.feedback_score += Math.max(
      -10,
      Math.min(10, Math.round((feedback.averageRating - 3) * 5)),
    );
  }
  if (feedback && feedback.highReactionCount > 0) {
    breakdown.feedback_score -= Math.min(20, feedback.highReactionCount * 10);
  }
  if (breakdown.feedback_score !== 0) {
    reasons.push(`最近 30 天反馈 ${signed(breakdown.feedback_score)}`);
  }

  if (owned.opened_at) {
    breakdown.inventory_priority += 8;
    reasons.push("已开封优先使用 +8");
  }
  if (owned.quantity_remaining_percent <= 30) {
    breakdown.inventory_priority += 5;
    reasons.push("低余量优先用完 +5");
  }

  const score = Math.max(
    0,
    Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
  );
  return {
    owned,
    owned_product_id: owned.id,
    role,
    reason: reasons.join("；"),
    reason_code: primaryReasonCode(role, breakdown, sensitive, highUv),
    score,
    score_breakdown: breakdown,
  };
}

function primaryReasonCode(
  role: RoutineRole,
  breakdown: ScoreBreakdown,
  sensitive: boolean,
  highUv: boolean,
): RoutineReasonCode {
  if (highUv && role === "sunscreen") return "HIGH_UV_SUNSCREEN_PRIORITY";
  if (sensitive && ["hydration", "moisturizer"].includes(role)) {
    return "HIGH_SENSITIVITY_BASIC_CARE";
  }
  if (breakdown.skin_fit >= 15 && role === "moisturizer") return "SKIN_DRYNESS_FIT";
  if (breakdown.feedback_score < 0) return "RECENT_HIGH_REACTION_PENALTY";
  if (breakdown.feedback_score > 0) return "RECENT_POSITIVE_FEEDBACK";
  if (breakdown.inventory_priority > 10) return "INVENTORY_USE_FIRST";
  return "BASE_ROUTINE_SELECTED";
}

function compareCandidates(a: ScoredCandidate, b: ScoredCandidate) {
  return b.score - a.score || a.owned.id.localeCompare(b.owned.id);
}

function toExcludedProduct(
  owned: OwnedProductWithProductRow,
  reasonCode: ExclusionReasonCode,
  reason: string,
): ExcludedProduct {
  return {
    owned_product_id: owned.id,
    product_id: owned.product_id,
    brand_name: owned.product.brand_name,
    product_name: owned.product.product_name,
    reason_code: reasonCode,
    reason,
  };
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export type RuleEngineService = {
  getToday(userId: string, periodInput: unknown): Promise<Routine | null>;
  getRoutine(userId: string, routineId: unknown): Promise<Routine>;
  generate(userId: string, input: unknown): Promise<Routine>;
};

export function createRuleEngineService(
  dependencies: RuleEngineDependencies,
): RuleEngineService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async getToday(userId, periodInput) {
      const profile = await dependencies.profiles.findByUserId(userId);
      const period = routineGenerateSchema.parse(periodInput).period;
      const date = dateInTimeZone(now(), profile?.timezone ?? "Asia/Shanghai");
      const row = await dependencies.routines.findByDate(userId, date, period);
      return row ? toRoutine(row) : null;
    },

    async getRoutine(userId, routineId) {
      const id = routineIdSchema.parse(routineId);
      const row = await dependencies.routines.findById(userId, id);
      if (!row) throw new RoutineNotFoundError();
      return toRoutine(row);
    },

    async generate(userId, input) {
      const { period } = routineGenerateSchema.parse(input);
      const profile = await dependencies.profiles.findByUserId(userId);
      const routineDate = dateInTimeZone(now(), profile?.timezone ?? "Asia/Shanghai");
      const [checkin, weather, products] = await Promise.all([
        dependencies.checkins.findByDate(userId, routineDate),
        dependencies.weather.findByDate(userId, routineDate),
        dependencies.ownedProducts.listByUserId(userId, {}),
      ]);
      const feedbackStats = await dependencies.usage.getRecentProductStats(
        userId,
        products.map((product) => product.id),
        routineDate,
      );
      const maxSteps = period === "am"
        ? profile?.max_am_steps ?? 4
        : profile?.max_pm_steps ?? 5;
      const plan = buildRoutinePlan({
        routineDate,
        period,
        checkin,
        weather,
        products,
        feedbackStats,
        maxSteps,
      });
      const skinSnapshot = snapshot(checkin);
      const weatherSnapshot = snapshot(weather);
      const existing = await dependencies.routines.findByDate(userId, routineDate, period);

      if (existing && routineMatches(existing, skinSnapshot, weatherSnapshot, plan)) {
        return toRoutine(existing);
      }

      const row = await dependencies.routines.replace({
        userId,
        routineDate,
        period,
        skinSnapshot,
        weatherSnapshot,
        excludedProducts: plan.excludedProducts,
        steps: plan.steps,
      });
      return toRoutine(row);
    },
  };
}

function routineMatches(
  existing: RoutineWithStepsRow,
  skinSnapshot: Json,
  weatherSnapshot: Json,
  plan: RoutinePlan,
) {
  const existingSteps = existing.steps.map((step) => ({
    owned_product_id: step.owned_product_id,
    step_order: step.step_order,
    role: step.role,
    reason: step.reason,
    reason_code: step.reason_code,
    score: step.score,
    score_breakdown: step.score_breakdown,
  }));
  return stableStringify(existing.skin_snapshot) === stableStringify(skinSnapshot)
    && stableStringify(existing.weather_snapshot) === stableStringify(weatherSnapshot)
    && stableStringify(existing.excluded_products) === stableStringify(plan.excludedProducts)
    && stableStringify(existingSteps) === stableStringify(plan.steps);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshot(value: SkinCheckinRow | WeatherRow | null): Json {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Json;
}

function toRoutine(row: RoutineWithStepsRow): Routine {
  return routineSchema.parse({
    id: row.id,
    routine_date: row.routine_date,
    period: row.period,
    skin_snapshot: row.skin_snapshot,
    weather_snapshot: row.weather_snapshot,
    excluded_products: row.excluded_products,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    steps: row.steps.map((step) => ({
      id: step.id,
      owned_product_id: step.owned_product_id,
      step_order: step.step_order,
      role: step.role,
      reason: step.reason,
      reason_code: step.reason_code,
      score: step.score,
      score_breakdown: step.score_breakdown,
      product: step.owned_product.product,
    })),
  });
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
