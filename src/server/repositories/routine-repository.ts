import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/db/database.types";
import type { ExcludedProduct, RoutinePeriod, RoutineReasonCode, RoutineRole, ScoreBreakdown } from "@/schemas/routine";
import type { OwnedProductWithProductRow } from "@/server/repositories/owned-product-repository";

export type RoutineRow = Tables<"routines">;
export type RoutineStepRow = Tables<"routine_steps">;
export type RoutineStepWithProductRow = RoutineStepRow & {
  owned_product: OwnedProductWithProductRow;
};
export type RoutineWithStepsRow = RoutineRow & {
  steps: RoutineStepWithProductRow[];
};

export type RoutineStepWrite = {
  owned_product_id: string;
  step_order: number;
  role: RoutineRole;
  reason: string;
  reason_code: RoutineReasonCode;
  score: number;
  score_breakdown: ScoreBreakdown;
};

export type RoutineRepository = {
  findByDate(
    userId: string,
    routineDate: string,
    period: RoutinePeriod,
  ): Promise<RoutineWithStepsRow | null>;
  findById(userId: string, routineId: string): Promise<RoutineWithStepsRow | null>;
  replace(input: {
    userId: string;
    routineDate: string;
    period: RoutinePeriod;
    skinSnapshot: Json;
    weatherSnapshot: Json;
    excludedProducts: ExcludedProduct[];
    steps: RoutineStepWrite[];
  }): Promise<RoutineWithStepsRow>;
};

const routineSelection = `
  *,
  steps:routine_steps(
    *,
    owned_product:user_owned_products(
      *,
      product:products(*)
    )
  )
` as const;

export function createRoutineRepository(
  supabase: SupabaseClient<Database>,
): RoutineRepository {
  async function findById(userId: string, routineId: string) {
    const { data, error } = await supabase
      .from("routines")
      .select(routineSelection)
      .eq("id", routineId)
      .eq("user_id", userId)
      .order("step_order", { referencedTable: "routine_steps", ascending: true })
      .maybeSingle();

    if (error) throw new Error("ROUTINE_READ_FAILED", { cause: error });
    return data as RoutineWithStepsRow | null;
  }

  return {
    async findByDate(userId, routineDate, period) {
      const { data, error } = await supabase
        .from("routines")
        .select(routineSelection)
        .eq("user_id", userId)
        .eq("routine_date", routineDate)
        .eq("period", period)
        .order("step_order", { referencedTable: "routine_steps", ascending: true })
        .maybeSingle();

      if (error) throw new Error("ROUTINE_READ_FAILED", { cause: error });
      return data as RoutineWithStepsRow | null;
    },

    findById,

    async replace(input) {
      const { data, error } = await supabase.rpc("replace_daily_routine", {
        p_routine_date: input.routineDate,
        p_period: input.period,
        p_skin_snapshot: input.skinSnapshot,
        p_weather_snapshot: input.weatherSnapshot,
        p_excluded_products: input.excludedProducts as unknown as Json,
        p_steps: input.steps as unknown as Json,
      });

      if (error || !data) {
        throw new Error("ROUTINE_WRITE_FAILED", { cause: error });
      }

      const routine = await findById(input.userId, data);
      if (!routine) throw new Error("ROUTINE_WRITE_FAILED");
      return routine;
    },
  };
}
