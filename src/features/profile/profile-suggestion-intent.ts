import type { Profile } from "@/schemas/profile";

export type ProfileSuggestionIntent =
  | { kind: "add_usual_area"; concern: "oiliness" | "dryness"; area: "t_zone" | "forehead" | "nose" | "nose_wings" | "cheeks" | "chin" }
  | { kind: "add_recurring_tendency"; concern: Profile["long_term_skin_baseline"]["recurring_tendencies"][number]["kind"]; area?: "t_zone" | "forehead" | "nose" | "nose_wings" | "cheeks" | "chin" };

const areas = ["t_zone", "forehead", "nose", "nose_wings", "cheeks", "chin"] as const;
const tendencyKinds = ["flaking", "redness", "reactive_discomfort", "blemishes", "small_bumps", "blackheads", "visible_pores", "dullness", "uneven_tone", "post_blemish_marks"] as const;

/** Query intent is transient convenience only; it never represents a Profile update. */
export function parseProfileSuggestionIntent(query: { suggestion?: string | string[]; concern?: string | string[]; area?: string | string[] }): ProfileSuggestionIntent | null {
  const suggestion = one(query.suggestion);
  const concern = one(query.concern);
  const area = one(query.area);
  const parsedArea = area && areas.includes(area as typeof areas[number]) ? area as Exclude<ProfileSuggestionIntent["area"], undefined> : undefined;
  if (area && !parsedArea) return null;
  if (suggestion === "usual_area" && parsedArea && (concern === "oiliness" || concern === "dryness")) return { kind: "add_usual_area", concern, area: parsedArea };
  if (suggestion === "recurring_tendency" && concern && tendencyKinds.includes(concern as typeof tendencyKinds[number])) return { kind: "add_recurring_tendency", concern: concern as Extract<ProfileSuggestionIntent, { kind: "add_recurring_tendency" }>["concern"], ...(parsedArea ? { area: parsedArea } : {}) };
  return null;
}

export function profileSuggestionHref(intent: ProfileSuggestionIntent) { return `/profile?suggestion=${intent.kind === "add_usual_area" ? "usual_area" : "recurring_tendency"}&concern=${encodeURIComponent(intent.concern)}&area=${encodeURIComponent(intent.area ?? "")}`; }

export function applyProfileSuggestionIntent(profile: Profile, intent: ProfileSuggestionIntent | null): Profile {
  if (!intent) return profile;
  const baseline = profile.long_term_skin_baseline;
  if (intent.kind === "add_usual_area") {
    const key = intent.concern === "oiliness" ? "usual_oily_areas" : "usual_dry_areas";
    if (baseline[key].includes(intent.area)) return profile;
    return { ...profile, long_term_skin_baseline: { ...baseline, [key]: [...baseline[key], intent.area] } };
  }
  if (baseline.recurring_tendencies.some((item) => item.kind === intent.concern)) return profile;
  return { ...profile, long_term_skin_baseline: { ...baseline, recurring_tendencies: [...baseline.recurring_tendencies, { kind: intent.concern, usual_areas: intent.area ? [intent.area] : [], tendency: "unknown", frequency: "unknown", usual_intensity: "unknown", source: "trend_suggestion_confirmed" }] } };
}

function one(value: string | string[] | undefined) { return typeof value === "string" ? value : undefined; }
