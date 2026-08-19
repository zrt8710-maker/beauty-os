import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/db/database.types";

export type PurchaseAnalysisRow = Tables<"purchase_analyses">;
export type PurchaseAnalysisWrite = {
  candidate_product_id: string | null;
  candidate_snapshot: Json;
  inventory_snapshot: Json;
  goal_snapshot: Json;
  duplicate_score: number;
  gap_score: number;
  compatibility_score: number;
  usage_probability_score: number;
  risk_score: number;
  final_score: number;
  decision: string;
  evidence: Json;
  unknowns: Json;
  reason_codes: string[];
};

export type PurchaseAnalysisRepository = {
  create(userId: string, input: PurchaseAnalysisWrite): Promise<PurchaseAnalysisRow>;
  listByUserId(userId: string, limit: number): Promise<PurchaseAnalysisRow[]>;
  findById(userId: string, analysisId: string): Promise<PurchaseAnalysisRow | null>;
};

export function createPurchaseAnalysisRepository(supabase: SupabaseClient<Database>): PurchaseAnalysisRepository {
  return {
    async create(userId, input) {
      void userId;
      const { data, error } = await supabase
        .rpc("persist_purchase_analysis", {
          // PostgreSQL accepts null for a manual candidate; generated RPC
          // argument types do not carry that nullability information.
          p_candidate_product_id: input.candidate_product_id as never,
          p_candidate_snapshot: input.candidate_snapshot,
          p_inventory_snapshot: input.inventory_snapshot,
          p_goal_snapshot: input.goal_snapshot,
          p_duplicate_score: input.duplicate_score,
          p_gap_score: input.gap_score,
          p_compatibility_score: input.compatibility_score,
          p_usage_probability_score: input.usage_probability_score,
          p_risk_score: input.risk_score,
          p_final_score: input.final_score,
          p_decision: input.decision,
          p_evidence: input.evidence,
          p_unknowns: input.unknowns,
          p_reason_codes: input.reason_codes,
        })
        .single();
      if (error || !data) throw new Error("PURCHASE_ANALYSIS_CREATE_FAILED", { cause: error });
      return data;
    },
    async listByUserId(userId, limit) {
      const { data, error } = await supabase.from("purchase_analyses").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
      if (error) throw new Error("PURCHASE_ANALYSIS_READ_FAILED", { cause: error });
      return data;
    },
    async findById(userId, analysisId) {
      const { data, error } = await supabase.from("purchase_analyses").select("*").eq("id", analysisId).eq("user_id", userId).maybeSingle();
      if (error) throw new Error("PURCHASE_ANALYSIS_READ_FAILED", { cause: error });
      return data;
    },
  };
}
