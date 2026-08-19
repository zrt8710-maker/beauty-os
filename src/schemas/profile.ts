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

const uniqueArray = <T extends z.ZodType<string>>(itemSchema: T, max: number) =>
  z
    .array(itemSchema)
    .max(max)
    .refine((items) => new Set(items).size === items.length, "不能包含重复项。");

export const profileInputSchema = z
  .object({
    skin_type: z.enum(SKIN_TYPES).nullable(),
    sensitivity_level: z.number().int().min(0).max(4),
    skin_goals: uniqueArray(z.enum(SKIN_GOALS), SKIN_GOALS.length),
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
