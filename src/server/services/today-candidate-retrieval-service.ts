import "server-only";

import type { RoutinePeriod } from "@/schemas/routine";
import type { DailyCareNeeds } from "@/server/domain/daily-care-needs";
import {
  CARE_STEP_PURPOSES,
  type CareStepPurpose,
  type PlannerProductEvidence,
} from "@/server/services/planner-product-evidence-service";
import {
  candidateMayServePurpose,
  type CarePlannerInput,
} from "@/server/services/today-care-planner-service";

type Candidate = CarePlannerInput["eligibleProducts"][number];

export type CandidateShortlist = {
  candidates: Candidate[];
  purposesByOwnedProductId: ReadonlyMap<string, CareStepPurpose[]>;
  gaps: CareStepPurpose[];
};

const MAX_UNIQUE_CANDIDATES = 12;
const BASE_LIMIT: Record<CareStepPurpose, number> = {
  cleansing: 2,
  sun_protection: 2,
  basic_moisturization: 3,
  hydration_support: 3,
  optional_treatment: 3,
};

const PURPOSE_ORDER: CareStepPurpose[] = [
  "cleansing",
  "basic_moisturization",
  "hydration_support",
  "sun_protection",
  "optional_treatment",
];

/**
 * Deterministic retrieval only: it decides which real candidates the Planner
 * may compare, never which product must win. Each purpose keeps incumbents,
 * strong ordinary candidates, and at most two diverse representatives.
 */
export function shortlistCarePlannerCandidates(input: {
  candidates: Candidate[];
  period: RoutinePeriod;
  dailyCareNeeds: DailyCareNeeds;
  incumbentOwnedProductIds?: ReadonlySet<string>;
  texturePreferences?: string[];
}): CandidateShortlist {
  const incumbents = input.incumbentOwnedProductIds ?? new Set<string>();
  const groups = new Map<CareStepPurpose, Candidate[]>();

  for (const purpose of PURPOSE_ORDER) {
    const eligible = input.candidates
      .filter((candidate) => candidateMayServePurpose(candidate, purpose))
      .sort((left, right) => compareForPurpose(left, right, purpose, input));
    groups.set(purpose, eligible);
  }

  const selected = new Map<string, Candidate>();
  const purposesById = new Map<string, Set<CareStepPurpose>>();
  const include = (candidate: Candidate, purpose: CareStepPurpose) => {
    selected.set(candidate.ownedProductId, candidate);
    const purposes = purposesById.get(candidate.ownedProductId) ?? new Set<CareStepPurpose>();
    purposes.add(purpose);
    purposesById.set(candidate.ownedProductId, purposes);
  };

  // Reserve one bounded slot for every required purpose before optional
  // candidates compete for the remaining capacity. This prevents a valid AM
  // sunscreen (or PM baseline product) from being lost only because its group
  // appears later in the global ordering.
  for (const purpose of requiredPurposes(input.period)) {
    const requiredCandidate = groups.get(purpose)?.[0];
    if (requiredCandidate) include(requiredCandidate, purpose);
  }

  // A still-eligible incumbent is always available to the Planner for a
  // maintain-vs-change judgment, even if another candidate ranks higher.
  for (const purpose of PURPOSE_ORDER) {
    for (const candidate of groups.get(purpose) ?? []) {
      if (incumbents.has(candidate.ownedProductId)) include(candidate, purpose);
    }
  }

  for (const purpose of PURPOSE_ORDER) {
    const group = groups.get(purpose) ?? [];
    for (const candidate of group.slice(0, BASE_LIMIT[purpose])) {
      if (selected.size >= MAX_UNIQUE_CANDIDATES && !selected.has(candidate.ownedProductId)) continue;
      include(candidate, purpose);
    }

    // Diversity is bounded: one feedback representative and one inventory or
    // texture representative may enlarge a group beyond its base list.
    const representatives = [
      bestBy(group, positiveFeedbackValue),
      bestBy(group, (candidate) => Math.max(
        lowInventoryValue(candidate),
        texturePreferenceValue(candidate, input.texturePreferences ?? []),
      )),
    ].filter((candidate): candidate is Candidate => candidate !== null);
    for (const candidate of representatives) {
      if (selected.size >= MAX_UNIQUE_CANDIDATES && !selected.has(candidate.ownedProductId)) continue;
      include(candidate, purpose);
    }
  }

  // Fill remaining capacity round-robin so one large group cannot starve a
  // smaller purpose. The cap is independent of the user's inventory size.
  const cursors = new Map(PURPOSE_ORDER.map((purpose) => [purpose, 0]));
  while (selected.size < MAX_UNIQUE_CANDIDATES) {
    for (const purpose of PURPOSE_ORDER) {
      const group = groups.get(purpose) ?? [];
      let cursor = cursors.get(purpose) ?? 0;
      while (cursor < group.length && selected.has(group[cursor]!.ownedProductId)) cursor += 1;
      cursors.set(purpose, cursor);
      const candidate = group[cursor];
      if (!candidate) continue;
      include(candidate, purpose);
      cursors.set(purpose, cursor + 1);
      if (selected.size >= MAX_UNIQUE_CANDIDATES) break;
    }
    const allPurposesExhausted = PURPOSE_ORDER.every((purpose) =>
      (cursors.get(purpose) ?? 0) >= (groups.get(purpose)?.length ?? 0));
    if (allPurposesExhausted) break;
  }

  const gaps = requiredPurposes(input.period).filter((purpose) =>
    ![...selected.values()].some((candidate) => candidateMayServePurpose(candidate, purpose)));

  return {
    candidates: [...selected.values()],
    purposesByOwnedProductId: new Map(
      [...purposesById].map(([id, purposes]) => [id, [...purposes].sort(purposeOrder)]),
    ),
    gaps,
  };
}

export function compactPlannerCandidates(input: {
  candidates: Candidate[];
  purposesByOwnedProductId: ReadonlyMap<string, CareStepPurpose[]>;
  dailyCareNeeds: DailyCareNeeds;
  period: RoutinePeriod;
}): Candidate[] {
  return input.candidates.map((candidate) => {
    const purposes = input.purposesByOwnedProductId.get(candidate.ownedProductId) ?? [];
    const evidence = compactEvidence(candidate.productEvidence, purposes, input.dailyCareNeeds, input.period);
    return {
      ...candidate,
      supportedPurposes: candidate.supportedPurposes.filter((purpose) => purposes.includes(purpose)),
      baselineTypeBackedPurposes: candidate.baselineTypeBackedPurposes?.filter((purpose) => purposes.includes(purpose)),
      productEvidence: evidence,
      knownFacts: evidence.knownFacts,
      unknownFields: evidence.unknownFields,
      limitations: evidence.limitations,
      usageHistory: {
        ...candidate.usageHistory,
        usageCount: usageCountBucket(candidate.usageHistory.usageCount),
        averageRating: ratingBucket(candidate.usageHistory.averageRating),
      },
    };
  });
}

function compactEvidence(
  evidence: PlannerProductEvidence,
  purposes: CareStepPurpose[],
  needs: DailyCareNeeds,
  period: RoutinePeriod,
): PlannerProductEvidence {
  const terms = relevanceTerms(purposes, needs, period);
  const claims = takeRelevant(evidence.claims, (claim) => claim.text, terms, 3);
  const usage = evidence.usage
    ? {
        instructions: takeText(evidence.usage.instructions, terms, 2),
        cautions: takeText(evidence.usage.cautions, terms, 2),
        evidenceRefs: evidence.usage.evidenceRefs.slice(0, 3),
      }
    : null;
  const relevantIngredientKnowledge = takeRelevant(
    evidence.ingredientKnowledge ?? [],
    (fact) => [fact.displayNameZh, fact.functions.join(" "), fact.statementZh].join(" "),
    terms,
    5,
  );
  const relevantIngredientNames = new Set(relevantIngredientKnowledge.map((fact) => fact.canonicalName.toLocaleLowerCase("en-US")));
  const ingredients = (evidence.ingredients ?? [])
    .filter((ingredient) => relevantIngredientNames.has(ingredient.normalizedName.toLocaleLowerCase("en-US")) || matchesTerms(ingredient.normalizedName, terms))
    .slice(0, 8);
  const advisoryIngredients = (evidence.advisoryIngredients ?? [])
    .filter((ingredient) => relevantIngredientNames.has(ingredient.name.toLocaleLowerCase("en-US")) || matchesTerms(ingredient.name, terms))
    .slice(0, 8);
  const refs = new Set([
    ...claims.flatMap((claim) => claim.evidenceRefs),
    ...(usage?.evidenceRefs ?? []),
    ...(evidence.texture?.evidenceRefs ?? []),
    ...ingredients.flatMap((ingredient) => ingredient.evidenceRefs),
    ...advisoryIngredients.flatMap((ingredient) => ingredient.evidenceRefs),
  ]);

  return {
    ...evidence,
    claims,
    usage,
    ingredients,
    advisoryIngredients,
    ingredientKnowledge: relevantIngredientKnowledge,
    sourceRefs: [],
    supportedPurposes: (evidence.supportedPurposes ?? []).filter((purpose) => purposes.includes(purpose)),
    evidenceRefs: [...refs].slice(0, 12),
    limitations: (evidence.limitations ?? []).slice(0, 2),
  };
}

function compareForPurpose(
  left: Candidate,
  right: Candidate,
  purpose: CareStepPurpose,
  input: Parameters<typeof shortlistCarePlannerCandidates>[0],
) {
  const difference = relevanceScore(right, purpose, input) - relevanceScore(left, purpose, input);
  return difference || left.ownedProductId.localeCompare(right.ownedProductId);
}

function relevanceScore(candidate: Candidate, purpose: CareStepPurpose, input: Parameters<typeof shortlistCarePlannerCandidates>[0]) {
  let score = 0;
  if (candidate.supportedPurposes.includes(purpose)) score += 40;
  else if (candidate.baselineTypeBackedPurposes?.includes(purpose)) score += 30;
  else if (candidate.productEvidence.evidenceRefs.length > 0) score += 20;
  if (purposeMatchesNeeds(purpose, input.dailyCareNeeds)) score += 12;
  score += positiveFeedbackValue(candidate);
  score += lowInventoryValue(candidate);
  score += texturePreferenceValue(candidate, input.texturePreferences ?? []);
  if (candidate.usageHistory.averageRating !== null && candidate.usageHistory.averageRating < 3) score -= 8;
  score -= Math.min(12, candidate.usageHistory.highReactionCount * 6);
  return score;
}

function purposeMatchesNeeds(purpose: CareStepPurpose, needs: DailyCareNeeds) {
  const priorities = new Set(needs.priorities.map((priority) => priority.code));
  if (purpose === "sun_protection") return priorities.has("sun_protection");
  if (purpose === "hydration_support") return ["hydration", "soothing", "oil_balance", "reduce_irritation"].some((code) => priorities.has(code as never));
  if (purpose === "basic_moisturization") return ["hydration", "barrier_support", "soothing", "reduce_irritation"].some((code) => priorities.has(code as never));
  return false;
}

function requiredPurposes(period: RoutinePeriod): CareStepPurpose[] {
  return period === "am" ? ["sun_protection"] : ["cleansing", "basic_moisturization"];
}

function positiveFeedbackValue(candidate: Candidate) {
  return Math.min(8, candidate.usageHistory.positiveSignals.length * 4 + Math.max(0, (candidate.usageHistory.averageRating ?? 3) - 3) * 2);
}

function lowInventoryValue(candidate: Candidate) {
  return candidate.inventory.quantityPercent > 0 && candidate.inventory.quantityPercent <= 30 ? 4 : 0;
}

function texturePreferenceValue(candidate: Candidate, preferences: string[]) {
  const texture = candidate.productEvidence.texture?.description.toLocaleLowerCase() ?? "";
  return preferences.some((preference) => texture.includes(preference.toLocaleLowerCase())) ? 6 : 0;
}

function bestBy(candidates: Candidate[], value: (candidate: Candidate) => number) {
  const ranked = candidates
    .map((candidate) => ({ candidate, value: value(candidate) }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value || left.candidate.ownedProductId.localeCompare(right.candidate.ownedProductId));
  return ranked[0]?.candidate ?? null;
}

function relevanceTerms(purposes: CareStepPurpose[], needs: DailyCareNeeds, period: RoutinePeriod) {
  const vocabulary: Record<string, string[]> = {
    cleansing: ["clean", "cleans", "remove", "清洁", "卸妆"],
    basic_moisturization: ["moist", "barrier", "cream", "lotion", "保湿", "屏障", "面霜", "乳液"],
    hydration_support: ["hydrat", "water", "sooth", "补水", "水分", "舒缓"],
    sun_protection: ["sun", "spf", "uv", "防晒", "紫外线"],
    optional_treatment: ["treat", "blemish", "bright", "修护", "痘", "提亮"],
    hydration: ["hydrat", "moist", "补水", "保湿"],
    barrier_support: ["barrier", "repair", "屏障", "修护"],
    oil_balance: ["oil", "sebum", "控油", "油脂"],
    soothing: ["sooth", "calm", "舒缓", "泛红"],
    reduce_irritation: ["gentle", "sensitive", "温和", "敏感", "刺激"],
  };
  return [...new Set([
    period,
    ...purposes.flatMap((purpose) => vocabulary[purpose] ?? []),
    ...needs.priorities.flatMap((priority) => vocabulary[priority.code] ?? []),
  ])];
}

function takeRelevant<T>(values: T[], text: (value: T) => string, terms: string[], limit: number) {
  return [...values]
    .map((value, index) => ({ value, index, relevant: matchesTerms(text(value), terms) }))
    .sort((left, right) => Number(right.relevant) - Number(left.relevant) || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.value);
}

function takeText(values: string[], terms: string[], limit: number) {
  return takeRelevant(values, (value) => value, terms, limit);
}

function matchesTerms(value: string, terms: string[]) {
  const normalized = value.toLocaleLowerCase();
  return terms.some((term) => normalized.includes(term.toLocaleLowerCase()));
}

function usageCountBucket(value: number) {
  if (value === 0) return 0;
  if (value === 1) return 1;
  if (value <= 4) return 2;
  return 5;
}

function ratingBucket(value: number | null) {
  if (value === null) return null;
  if (value < 3) return 2;
  if (value < 4) return 3;
  return 4;
}

function purposeOrder(left: CareStepPurpose, right: CareStepPurpose) {
  return CARE_STEP_PURPOSES.indexOf(left) - CARE_STEP_PURPOSES.indexOf(right);
}
