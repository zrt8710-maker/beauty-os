import "server-only";

import { z } from "zod";

import {
  skinCheckinIdSchema,
  skinCheckinInputSchema,
  skinCheckinListQuerySchema,
  skinCheckinSchema,
  skinCheckinUpdateSchema,
  dailyStateSchema,
  type SkinCheckin,
} from "@/schemas/checkin";
import type {
  SkinCheckinRepository,
  SkinCheckinRow,
} from "@/server/repositories/skin-checkin-repository";

export class SkinCheckinNotFoundError extends Error {
  constructor() {
    super("SKIN_CHECKIN_NOT_FOUND");
    this.name = "SkinCheckinNotFoundError";
  }
}

const databaseIsoTimestampSchema = z.iso.datetime({ offset: true });
const legacyDatabaseTimestampPattern =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

function normalizeCreatedAt(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("skin_checkins.created_at must be a non-empty timestamp string.");
  }

  const candidate = legacyDatabaseTimestampPattern.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;

  if (!databaseIsoTimestampSchema.safeParse(candidate).success) {
    throw new TypeError("skin_checkins.created_at must be an ISO datetime or legacy database datetime.");
  }

  return new Date(candidate).toISOString();
}

export function safeDailyState(value: unknown, checkinId?: string) {
  if (value === null || value === undefined) return null;
  const parsed = dailyStateSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (process.env.NODE_ENV !== "production") {
    console.warn("[skin-checkin] ignoring malformed daily_state", { checkinId, issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })) });
  }
  return null;
}

function toSkinCheckin(row: SkinCheckinRow): SkinCheckin {
  const isLegacy = row.known_fields === null || row.known_fields === undefined;
  return skinCheckinSchema.parse({
    id: row.id,
    dryness_level: row.dryness_level,
    oiliness_level: row.oiliness_level,
    redness_level: row.redness_level,
    sensitivity_level: row.sensitivity_level,
    acne_level: row.acne_level,
    daily_state: safeDailyState(row.daily_state, row.id),
    notes: row.notes,
    recorded_date: row.recorded_date,
    created_at: normalizeCreatedAt(row.created_at),
    known_fields: isLegacy ? [] : row.known_fields,
    field_provenance: isLegacy ? {} : row.field_provenance ?? {},
    is_legacy: isLegacy,
  });
}

function toInput(row: SkinCheckinRow) {
  return {
    dryness_level: row.dryness_level,
    oiliness_level: row.oiliness_level,
    redness_level: row.redness_level,
    sensitivity_level: row.sensitivity_level,
    acne_level: row.acne_level,
    daily_state: safeDailyState(row.daily_state, row.id),
    notes: row.notes,
    recorded_date: row.recorded_date,
    known_fields: row.known_fields ?? [],
    field_provenance: row.field_provenance ?? {},
  };
}

export type SkinCheckinService = {
  listCheckins(userId: string, query: unknown): Promise<SkinCheckin[]>;
  createOrUpdateCheckin(userId: string, input: unknown): Promise<SkinCheckin>;
  updateCheckin(
    userId: string,
    checkinId: unknown,
    input: unknown,
  ): Promise<SkinCheckin>;
};

export function createSkinCheckinService(
  repository: SkinCheckinRepository,
): SkinCheckinService {
  return {
    async listCheckins(userId, query) {
      const validated = skinCheckinListQuerySchema.parse(query);
      return (await repository.listByUserId(userId, validated)).map(
        toSkinCheckin,
      );
    },

    async createOrUpdateCheckin(userId, input) {
      const validated = skinCheckinInputSchema.parse(input);
      return toSkinCheckin(await repository.upsertByDate(userId, validated));
    },

    async updateCheckin(userId, checkinId, input) {
      const validatedId = skinCheckinIdSchema.parse(checkinId);
      const validatedUpdate = skinCheckinUpdateSchema.parse(input);
      const existing = await repository.findById(userId, validatedId);

      if (!existing) {
        throw new SkinCheckinNotFoundError();
      }

      const merged = skinCheckinInputSchema.parse({
        ...toInput(existing),
        ...validatedUpdate,
      });
      const { recorded_date: _recordedDate, ...update } = merged;
      const updated = await repository.update(
        userId,
        validatedId,
        update,
      );

      if (!updated) {
        throw new SkinCheckinNotFoundError();
      }

      return toSkinCheckin(updated);
    },
  };
}
