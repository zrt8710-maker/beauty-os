import { z } from "zod";

export const weatherLocationSearchSchema = z.object({
  query: z.string().trim().min(1).max(120),
}).strict();

export const weatherLocationCandidateSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(120).nullable(),
  country: z.string().trim().min(1).max(120).nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().trim().min(1).max(100),
}).strict();
