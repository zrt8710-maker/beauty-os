import { z } from "zod";

export const SKIN_TYPES = [
  "dry",
  "oily",
  "combination",
  "normal",
  "unknown",
] as const;

export const SKIN_GOALS = [
  "hydration",
  "barrier_support",
  "oil_control",
  "blemish_care",
  "redness_relief",
  "brightening",
  "dark_spots",
  "anti_aging",
] as const;

export const TEXTURE_PREFERENCES = [
  "lightweight",
  "rich",
  "gel",
  "cream",
  "lotion",
  "oil",
] as const;

export const LONG_TERM_SKIN_AREAS = ["t_zone", "forehead", "nose", "nose_wings", "cheeks", "chin", "full_face"] as const;
export const RECURRING_TENDENCY_KINDS = ["flaking", "redness", "reactive_discomfort", "blemishes", "small_bumps", "blackheads", "visible_pores", "dullness", "uneven_tone", "post_blemish_marks"] as const;
export const TENDENCY_LEVELS = ["occasional", "recurring", "frequent", "unknown"] as const;
/** `tendency` is the persisted v0.3 compatibility field; new writes may also carry its explicit alias. */
export const FREQUENCY_LEVELS = TENDENCY_LEVELS;
/** Profile-only meaning: a recurring tendency's usual presentation when it appears. */
export const USUAL_INTENSITY_LEVELS = ["slight", "noticeable", "marked", "very_marked", "unknown"] as const;
export const LEGACY_USUAL_INTENSITY_LEVELS = ["mild", "moderate", "marked", "unknown"] as const;
export const TENDENCY_SOURCES = ["user_declared", "trend_suggestion_confirmed"] as const;

function uniqueArray<T extends z.ZodType<string>>(itemSchema: T, max: number) {
  return z
    .array(itemSchema)
    .max(max)
    .refine((items) => new Set(items).size === items.length, "不能包含重复项。");
}

const usualIntensitySchema = z.preprocess((value) => {
  if (value === "mild") return "slight";
  if (value === "moderate") return "noticeable";
  return value;
}, z.enum(USUAL_INTENSITY_LEVELS));

const longTermSkinBaselineSchema = z.object({
  usual_oily_areas: z.array(z.enum(LONG_TERM_SKIN_AREAS)).max(LONG_TERM_SKIN_AREAS.length).default([]),
  usual_dry_areas: z.array(z.enum(LONG_TERM_SKIN_AREAS)).max(LONG_TERM_SKIN_AREAS.length).default([]),
  recurring_tendencies: z.array(z.object({ kind: z.enum(RECURRING_TENDENCY_KINDS), usual_areas: z.array(z.enum(LONG_TERM_SKIN_AREAS)).max(LONG_TERM_SKIN_AREAS.length).default([]), tendency: z.enum(TENDENCY_LEVELS).default("unknown"), frequency: z.enum(FREQUENCY_LEVELS).optional(), usual_intensity: usualIntensitySchema.default("unknown"), source: z.enum(TENDENCY_SOURCES) }).strict()).max(RECURRING_TENDENCY_KINDS.length).default([]).refine((items) => new Set(items.map((item) => item.kind)).size === items.length, "不能包含重复的长期倾向。"),
}).strict().default({ usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [] });

export type LongTermSkinBaseline = z.infer<typeof longTermSkinBaselineSchema>;

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "请输入有效的 IANA 时区，例如 Asia/Shanghai。");

const locationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  })
  .superRefine((location, context) => {
    const hasLatitude = location.latitude !== null;
    const hasLongitude = location.longitude !== null;

    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: "custom",
        message: "纬度和经度必须同时填写或同时留空。",
        path: hasLatitude ? ["longitude"] : ["latitude"],
      });
    }
  });

export const profileInputSchema = z
  .object({
    skin_type: z.enum(SKIN_TYPES).nullable(),
    /** User-declared long-term sensitivity tendency, not today's discomfort. */
    sensitivity_level: z.number().int().min(0).max(4),
    skin_goals: uniqueArray(z.enum(SKIN_GOALS), SKIN_GOALS.length),
    long_term_skin_baseline: longTermSkinBaselineSchema,
    preferred_routine_length: z.object({
      am_steps: z.number().int().min(1).max(8),
      pm_steps: z.number().int().min(1).max(8),
    }),
    texture_preferences: uniqueArray(
      z.enum(TEXTURE_PREFERENCES),
      TEXTURE_PREFERENCES.length,
    ),
    avoid_ingredients: uniqueArray(
      z.string().trim().min(1).max(100),
      30,
    ),
    timezone: timezoneSchema,
    location: locationSchema,
  })
  .strict();

export const profileSchema = profileInputSchema.extend({
  onboarding_completed_at: z.iso.datetime().nullable(),
  updated_at: z.iso.datetime(),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type Profile = z.infer<typeof profileSchema>;
