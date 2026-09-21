import type { DailyCareNeeds } from "@/server/domain/daily-care-needs";

import type {
  ProductDecisionCapabilityCode,
  ProductDecisionProfile,
} from "./types";

export type ProductCapabilityNeedsMatch = {
  capability_code: ProductDecisionCapabilityCode;
  priority_code: ProductDecisionCapabilityCode;
  confidence: number;
  bonus: number;
};

export type ProductCapabilityNeedsMatchResult = {
  matches: ProductCapabilityNeedsMatch[];
  applied_bonus: number;
};

export function matchCapabilitiesToDailyCareNeeds(
  profile: ProductDecisionProfile,
  needs: DailyCareNeeds | undefined,
): ProductCapabilityNeedsMatchResult {
  if (!needs || profile.knowledge_status !== "verified") {
    return { matches: [], applied_bonus: 0 };
  }

  const priorities = new Map(
    needs.priorities.map((priority) => [priority.code, priority]),
  );
  const matches = profile.capabilities.flatMap((capability) => {
    const priority = priorities.get(capability.code);
    if (!priority) return [];

    return [{
      capability_code: capability.code,
      priority_code: capability.code,
      confidence: capability.confidence,
      bonus: priority.level === "high" ? 15 : priority.level === "medium" ? 10 : 5,
    }];
  });

  return {
    matches,
    // Multiple claims must not stack into an unbounded knowledge bonus.
    applied_bonus: Math.max(0, ...matches.map((match) => match.bonus)),
  };
}
