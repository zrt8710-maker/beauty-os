import type { DailyCarePriorityCode } from "@/server/domain/daily-care-needs";
import type {
  ProductDecisionProfile,
} from "@/server/domain/product-decision";
import type { RoutinePeriod, RoutineRole } from "@/schemas/routine";

type CoverageCandidate = {
  ownedProductId: string;
  role: RoutineRole;
  /** Already ranked by the Rule Engine; this helper never calculates scores. */
  rank: number;
  decisionProfile: ProductDecisionProfile | undefined;
};

const baselineRolesByPeriod: Record<RoutinePeriod, RoutineRole[]> = {
  am: ["sunscreen"],
  pm: ["cleanser", "moisturizer"],
};

const conditionAddedRolesByPeriod: Record<RoutinePeriod, RoutineRole[]> = {
  am: ["moisturizer", "hydration"],
  pm: ["hydration"],
};

/**
 * Decision A for the functional core of a routine. These roles are not
 * inferred from what happens to be in the user's inventory.
 */
export function baselineRolesForMinimumSufficientRoutine(
  period: RoutinePeriod,
): RoutineRole[] {
  return [...baselineRolesByPeriod[period]];
}

/** Only verified Product Knowledge capabilities are evidence of coverage. */
export function verifiedCoverageForCandidates(
  candidates: ReadonlyArray<Pick<CoverageCandidate, "decisionProfile">>,
): Set<DailyCarePriorityCode> {
  const coverage = new Set<DailyCarePriorityCode>();
  for (const candidate of candidates) {
    if (candidate.decisionProfile?.knowledge_status !== "verified") continue;
    for (const capability of candidate.decisionProfile.capabilities) {
      coverage.add(capability.code);
    }
  }
  return coverage;
}

export function residualPriorities(
  priorities: ReadonlyArray<DailyCarePriorityCode>,
  coverage: ReadonlySet<DailyCarePriorityCode>,
): DailyCarePriorityCode[] {
  return [...new Set(priorities)].filter((priority) => !coverage.has(priority));
}

/**
 * Chooses a minimum set of already-ranked, condition-added candidates. A
 * candidate may enter only when its verified capabilities cover a currently
 * residual Today priority. Functional roles and treatment do not participate.
 */
export function selectMinimumSufficientConditionCandidates({
  period,
  residual,
  candidates,
}: {
  period: RoutinePeriod;
  residual: ReadonlyArray<DailyCarePriorityCode>;
  candidates: ReadonlyArray<CoverageCandidate>;
}): CoverageCandidate[] {
  const remaining = new Set(residual);
  const roleOrder = conditionAddedRolesByPeriod[period];
  const bestByRole = new Map<RoutineRole, CoverageCandidate>();

  for (const candidate of candidates) {
    if (!roleOrder.includes(candidate.role)) continue;
    if (coverageFor(candidate, remaining).length === 0) continue;
    const current = bestByRole.get(candidate.role);
    if (!current || compareRankedCandidates(candidate, current) < 0) {
      bestByRole.set(candidate.role, candidate);
    }
  }

  const selected: CoverageCandidate[] = [];
  while (remaining.size > 0) {
    const next = [...bestByRole.values()]
      .filter((candidate) => !selected.includes(candidate))
      .map((candidate) => ({ candidate, coverage: coverageFor(candidate, remaining) }))
      .filter((entry) => entry.coverage.length > 0)
      .sort((left, right) =>
        right.coverage.length - left.coverage.length
        || roleOrder.indexOf(left.candidate.role) - roleOrder.indexOf(right.candidate.role)
        || compareRankedCandidates(left.candidate, right.candidate),
      )[0];
    if (!next) break;

    selected.push(next.candidate);
    for (const priority of next.coverage) remaining.delete(priority);
  }

  return selected;
}

function coverageFor(
  candidate: Pick<CoverageCandidate, "decisionProfile">,
  priorities: ReadonlySet<DailyCarePriorityCode>,
): DailyCarePriorityCode[] {
  if (candidate.decisionProfile?.knowledge_status !== "verified") return [];
  return candidate.decisionProfile.capabilities.flatMap((capability) =>
    priorities.has(capability.code) ? [capability.code] : [],
  );
}

function compareRankedCandidates(left: CoverageCandidate, right: CoverageCandidate) {
  return right.rank - left.rank
    || left.ownedProductId.localeCompare(right.ownedProductId);
}

export type { CoverageCandidate };
