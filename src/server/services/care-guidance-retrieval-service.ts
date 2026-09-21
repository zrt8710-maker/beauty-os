import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type CareGuidance = { guidanceId: string; situation: string; principle: string; plannerMay: string; plannerMustNot: string };

const tags: Record<string, string[]> = {
  "GUIDE-BASELINE-DELTA-01": ["baseline", "delta"],
  "GUIDE-CLEANSE-01": ["cleanser", "dryness", "flaking", "reactive", "pm"],
  "GUIDE-MOISTURE-01": ["dryness", "flaking", "hydration", "barrier_support"],
  "GUIDE-FLAKE-01": ["dryness", "flaking", "roughness"],
  "GUIDE-OIL-01": ["oiliness", "baseline"],
  "GUIDE-REACTIVE-01": ["redness", "stinging", "burning", "itching"],
  "GUIDE-BLEMISH-01": ["blemishes", "small_bumps"],
  "GUIDE-TREATMENT-01": ["treatment"],
  "GUIDE-WEATHER-01": ["weather", "uv", "am"],
  "GUIDE-MIN-SUFFICIENT-01": ["always"],
  "GUIDE-PRODUCT-FIT-01": ["always"],
  "GUIDE-UNCERTAINTY-01": ["unknown"],
};

export function parseCareGuidance(markdown: string): CareGuidance[] {
  const chunks = markdown.split(/^### (GUIDE-[A-Z0-9-]+)$/m);
  const output: CareGuidance[] = [];
  for (let index = 1; index < chunks.length; index += 2) {
    const guidanceId = chunks[index]!;
    const body = chunks[index + 1] ?? "";
    const section = (name: string) => body.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\n\\*\\*|$)`))?.[1]?.trim() ?? "";
    const situation = section("Situation"); const principle = section("Evidence-backed skincare principle");
    const plannerMay = section("Planner may"); const plannerMustNot = section("Planner must not");
    if (situation && principle && plannerMay && plannerMustNot) output.push({ guidanceId, situation, principle, plannerMay, plannerMustNot });
  }
  return output;
}

let cached: CareGuidance[] | null = null;
export function loadCareGuidance(): CareGuidance[] {
  cached ??= parseCareGuidance(readFileSync(join(process.cwd(), "docs", "CARE_DECISION_GUIDANCE_V0.1.md"), "utf8"));
  return cached;
}

export function retrieveCareGuidance(input: { effectiveSkinState: Array<{ concern?: string; provenance?: string }>; dailyDelta: Array<{ concern?: string }>; period: "am" | "pm"; weather: { uvIndex: number | null } | null; unknowns: string[] }): CareGuidance[] {
  const signals = new Set<string>(["always", input.period, ...input.effectiveSkinState.map((x) => x.concern ?? ""), ...input.dailyDelta.map((x) => x.concern ?? ""), ...(input.dailyDelta.length ? ["delta"] : []), ...(input.weather?.uvIndex ? ["weather", "uv"] : []), ...(input.unknowns.length ? ["unknown"] : [])]);
  return loadCareGuidance().map((guidance) => ({ guidance, score: (tags[guidance.guidanceId] ?? []).filter((tag) => signals.has(tag)).length }))
    .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.guidance.guidanceId.localeCompare(b.guidance.guidanceId)).slice(0, 6).map((item) => item.guidance);
}
