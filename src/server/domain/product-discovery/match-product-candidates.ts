import {
  type NormalizedProductDiscoveryQuery,
  type ProductDiscoveryCandidate,
  type ProductDiscoveryIssue,
  type ProductDiscoveryResult,
} from "@/schemas/product-discovery";

type CandidateMatch = Pick<ProductDiscoveryResult, "status" | "candidates"> & {
  warnings: ProductDiscoveryIssue[];
};

export function matchProductCandidates(
  query: NormalizedProductDiscoveryQuery,
  candidates: ProductDiscoveryCandidate[],
): CandidateMatch {
  const deduplicated = deduplicateCandidates(candidates);
  const scored = deduplicated
    .map((candidate) => scoreCandidate(query, candidate))
    .filter((candidate): candidate is ProductDiscoveryCandidate =>
      candidate !== null)
    .sort(compareCandidates)
    .slice(0, query.limit);

  if (scored.length === 0) {
    return { status: "no_match", candidates: [], warnings: [] };
  }

  if (scored.some((candidate) => candidate.conflicts.length > 0)) {
    return { status: "conflict", candidates: scored, warnings: [] };
  }

  if (query.mode === "barcode") {
    return {
      status: scored.length === 1 ? "existing_exact" : "conflict",
      candidates: scored,
      warnings: [],
    };
  }

  const exact = scored.filter((candidate) =>
    candidate.match_reason === "normalized_identity_exact");

  if (exact.length === 1) {
    return { status: "existing_exact", candidates: scored, warnings: [] };
  }

  if (exact.length > 1 && hasMultipleVariants(exact)) {
    return {
      status: "existing_variant_candidates",
      candidates: scored,
      warnings: [],
    };
  }

  return { status: "ambiguous", candidates: scored, warnings: [] };
}

export function normalizeIdentityText(value: string | null): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function scoreCandidate(
  query: NormalizedProductDiscoveryQuery,
  candidate: ProductDiscoveryCandidate,
): ProductDiscoveryCandidate | null {
  if (query.mode === "barcode") {
    if (candidate.barcode !== query.barcode) return null;
    return {
      ...candidate,
      discovery_score: 100,
      match_reason: "barcode_exact",
    };
  }

  const requestedBrand = normalizeIdentityText(query.brand_name);
  const candidateBrand = normalizeIdentityText(candidate.brand_name);
  const requestedName = normalizeIdentityText(query.product_name);
  const candidateName = normalizeIdentityText(candidate.product_name);
  const brandMatches = requestedBrand === ""
    || requestedBrand === candidateBrand;
  const nameMatches = requestedName === candidateName;

  if (brandMatches && nameMatches) {
    return {
      ...candidate,
      discovery_score: query.brand_name === null ? 92 : 96,
      match_reason: "normalized_identity_exact",
    };
  }

  const containsName = candidateName.includes(requestedName)
    || requestedName.includes(candidateName);
  if (!containsName || !brandMatches) return null;

  return {
    ...candidate,
    discovery_score: query.brand_name === null ? 75 : 82,
    match_reason: "name_contains",
  };
}

function deduplicateCandidates(
  candidates: ProductDiscoveryCandidate[],
): ProductDiscoveryCandidate[] {
  const exact = deduplicateExactCandidates(candidates);
  const merged: ProductDiscoveryCandidate[] = [];

  for (const originalCandidate of exact) {
    let candidate = originalCandidate;
    let handled = false;

    for (let index = 0; index < merged.length; index += 1) {
      const current = merged[index];
      const relationship = compareCandidateIdentity(current, candidate);

      if (relationship === "same_product") {
        merged[index] = mergeCandidates(current, candidate);
        handled = true;
        break;
      }

      if (relationship === "variant_conflict") {
        const issue = {
          code: "PRODUCT_DISCOVERY_VARIANT_CONFLICT",
          message: "相同 barcode 的候选产品具有不同 variant。",
          fields: ["barcode", "variant_name"],
        };
        merged[index] = addConflict(current, issue);
        candidate = addConflict(candidate, issue);
        handled = true;
        merged.push(candidate);
        break;
      }

      if (relationship === "identity_conflict") {
        const issue = {
          code: "PRODUCT_DISCOVERY_IDENTITY_CONFLICT",
          message: "相同 barcode 的候选产品身份不一致。",
          fields: ["barcode", "brand_name", "product_name"],
        };
        merged[index] = addConflict(current, issue);
        candidate = addConflict(candidate, issue);
        handled = true;
        merged.push(candidate);
        break;
      }
    }

    if (!handled) merged.push(candidate);
  }

  return merged;
}

function deduplicateExactCandidates(
  candidates: ProductDiscoveryCandidate[],
): ProductDiscoveryCandidate[] {
  const unique = new Map<string, ProductDiscoveryCandidate>();

  for (const candidate of candidates) {
    const key = candidate.existing_catalog_product_id
      ? `catalog:${candidate.existing_catalog_product_id}`
      : `candidate:${candidate.candidate_id}`;
    const existing = unique.get(key);

    if (!existing) {
      unique.set(key, candidate);
      continue;
    }

    unique.set(key, mergeCandidates(existing, candidate));
  }

  return [...unique.values()];
}

function compareCandidateIdentity(
  left: ProductDiscoveryCandidate,
  right: ProductDiscoveryCandidate,
): "unrelated" | "same_product" | "variant_conflict" | "identity_conflict" {
  const sameBarcode = left.barcode !== null
    && right.barcode !== null
    && left.barcode === right.barcode;
  const differentBarcodes = left.barcode !== null
    && right.barcode !== null
    && left.barcode !== right.barcode;
  const sameBrand = sameKnownText(left.brand_name, right.brand_name);
  const sameName = sameKnownText(left.product_name, right.product_name);
  const sameVariant = compatibleVariant(left.variant_name, right.variant_name);

  if (sameBarcode) {
    if (
      conflictingKnownText(left.brand_name, right.brand_name)
      || conflictingKnownText(left.product_name, right.product_name)
    ) {
      return "identity_conflict";
    }
    if (!sameVariant) return "variant_conflict";
    return "same_product";
  }

  if (differentBarcodes) return "unrelated";
  return sameBrand && sameName && sameVariant ? "same_product" : "unrelated";
}

function mergeCandidates(
  left: ProductDiscoveryCandidate,
  right: ProductDiscoveryCandidate,
): ProductDiscoveryCandidate {
  const [preferred, secondary] = preferCandidate(left, right);
  return {
    ...preferred,
    brand_name: preferred.brand_name ?? secondary.brand_name,
    variant_name: preferred.variant_name ?? secondary.variant_name,
    barcode: preferred.barcode ?? secondary.barcode,
    category_suggestion:
      preferred.category_suggestion ?? secondary.category_suggestion,
    subcategory_suggestion:
      preferred.subcategory_suggestion ?? secondary.subcategory_suggestion,
    product_type_suggestion:
      preferred.product_type_suggestion ?? secondary.product_type_suggestion,
    market: preferred.market ?? secondary.market,
    locale: preferred.locale ?? secondary.locale,
    image_preview_url:
      preferred.image_preview_url ?? secondary.image_preview_url,
    existing_catalog_product_id:
      preferred.existing_catalog_product_id
      ?? secondary.existing_catalog_product_id,
    sources: mergeSources(preferred.sources, secondary.sources),
    warnings: mergeIssues(preferred.warnings, secondary.warnings),
    conflicts: mergeIssues(preferred.conflicts, secondary.conflicts),
    completeness: Math.max(preferred.completeness, secondary.completeness),
  };
}

function preferCandidate(
  left: ProductDiscoveryCandidate,
  right: ProductDiscoveryCandidate,
): [ProductDiscoveryCandidate, ProductDiscoveryCandidate] {
  if (left.candidate_kind === "internal_verified") return [left, right];
  if (right.candidate_kind === "internal_verified") return [right, left];
  if (right.completeness > left.completeness) return [right, left];
  return [left, right];
}

function addConflict(
  candidate: ProductDiscoveryCandidate,
  issue: ProductDiscoveryIssue,
): ProductDiscoveryCandidate {
  return {
    ...candidate,
    verification_eligibility: "ineligible",
    conflicts: mergeIssues(candidate.conflicts, [issue]),
  };
}

function mergeSources(
  left: ProductDiscoveryCandidate["sources"],
  right: ProductDiscoveryCandidate["sources"],
) {
  const sources = new Map<string, ProductDiscoveryCandidate["sources"][number]>();
  [...left, ...right].forEach((source) => {
    const key = `${source.provider_code}:${source.raw_record_id ?? source.source_url}`;
    const existing = sources.get(key);
    sources.set(key, existing
      ? {
        ...existing,
        fields_supported: [...new Set([
          ...existing.fields_supported,
          ...source.fields_supported,
        ])],
        source_quality: maxNullableQuality(
          existing.source_quality,
          source.source_quality,
        ),
      }
      : source);
  });
  return [...sources.values()];
}

function mergeIssues(
  left: ProductDiscoveryIssue[],
  right: ProductDiscoveryIssue[],
) {
  const issues = new Map<string, ProductDiscoveryIssue>();
  [...left, ...right].forEach((issue) => {
    issues.set(`${issue.code}:${issue.fields.join(",")}`, issue);
  });
  return [...issues.values()];
}

function hasMultipleVariants(candidates: ProductDiscoveryCandidate[]) {
  return new Set(candidates.map((candidate) =>
    normalizeIdentityText(candidate.variant_name))).size > 1;
}

function sameKnownText(left: string | null, right: string | null) {
  const normalizedLeft = normalizeIdentityText(left);
  const normalizedRight = normalizeIdentityText(right);
  return normalizedLeft !== ""
    && normalizedRight !== ""
    && normalizedLeft === normalizedRight;
}

function conflictingKnownText(left: string | null, right: string | null) {
  const normalizedLeft = normalizeIdentityText(left);
  const normalizedRight = normalizeIdentityText(right);
  return normalizedLeft !== ""
    && normalizedRight !== ""
    && normalizedLeft !== normalizedRight;
}

function compatibleVariant(left: string | null, right: string | null) {
  const normalizedLeft = normalizeIdentityText(left);
  const normalizedRight = normalizeIdentityText(right);
  return normalizedLeft === ""
    || normalizedRight === ""
    || normalizedLeft === normalizedRight;
}

function maxNullableQuality(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function compareCandidates(
  left: ProductDiscoveryCandidate,
  right: ProductDiscoveryCandidate,
) {
  return right.discovery_score - left.discovery_score
    || left.product_name.localeCompare(right.product_name)
    || (left.variant_name ?? "").localeCompare(right.variant_name ?? "")
    || left.candidate_id.localeCompare(right.candidate_id);
}
