import "server-only";

import {
  skinCheckinIdSchema,
  skinCheckinInputSchema,
  skinCheckinListQuerySchema,
  skinCheckinSchema,
  skinCheckinUpdateSchema,
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

function toSkinCheckin(row: SkinCheckinRow): SkinCheckin {
  return skinCheckinSchema.parse({
    id: row.id,
    dryness_level: row.dryness_level,
    oiliness_level: row.oiliness_level,
    redness_level: row.redness_level,
    sensitivity_level: row.sensitivity_level,
    acne_level: row.acne_level,
    notes: row.notes,
    recorded_date: row.recorded_date,
    created_at: row.created_at,
  });
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

      const updated = await repository.update(
        userId,
        validatedId,
        validatedUpdate,
      );

      if (!updated) {
        throw new SkinCheckinNotFoundError();
      }

      return toSkinCheckin(updated);
    },
  };
}
