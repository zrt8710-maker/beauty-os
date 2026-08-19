import { z } from "zod";

export const SKIN_LEVEL_MIN = 0;
export const SKIN_LEVEL_MAX = 4;

const skinLevelSchema = z.number().int().min(SKIN_LEVEL_MIN).max(SKIN_LEVEL_MAX);
const nullableNotesSchema = z.string().trim().min(1).max(2000).nullable();

export const skinCheckinInputSchema = z
  .object({
    dryness_level: skinLevelSchema,
    oiliness_level: skinLevelSchema,
    redness_level: skinLevelSchema,
    sensitivity_level: skinLevelSchema,
    acne_level: skinLevelSchema,
    notes: nullableNotesSchema,
    recorded_date: z.iso.date(),
  })
  .strict();

export const skinCheckinUpdateSchema = skinCheckinInputSchema
  .omit({ recorded_date: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少需要更新一个字段。");

export const skinCheckinSchema = skinCheckinInputSchema.extend({
  id: z.uuid(),
  created_at: z.iso.datetime(),
});

export const skinCheckinListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(30).default(7),
  })
  .strict();

export const skinCheckinIdSchema = z.uuid();

export type SkinCheckin = z.infer<typeof skinCheckinSchema>;
export type SkinCheckinInput = z.infer<typeof skinCheckinInputSchema>;
export type SkinCheckinUpdateInput = z.infer<typeof skinCheckinUpdateSchema>;
export type SkinCheckinListQuery = z.infer<typeof skinCheckinListQuerySchema>;
