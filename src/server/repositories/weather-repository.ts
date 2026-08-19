import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json, Tables } from "@/db/database.types";

export type WeatherRow = Tables<"weather_data">;

export type WeatherWrite = {
  recorded_date: string;
  temperature: number | null;
  humidity: number | null;
  uv_index: number | null;
  weather_code: string | null;
  source: string;
  raw_payload: Json;
  created_at: string;
};

export type WeatherRepository = {
  findLatestByUserId(userId: string): Promise<WeatherRow | null>;
  findByDate(userId: string, recordedDate: string): Promise<WeatherRow | null>;
  upsertByDate(userId: string, input: WeatherWrite): Promise<WeatherRow>;
};

export function createWeatherRepository(
  supabase: SupabaseClient<Database>,
): WeatherRepository {
  return {
    async findLatestByUserId(userId) {
      const { data, error } = await supabase
        .from("weather_data")
        .select("*")
        .eq("user_id", userId)
        .order("recorded_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error("WEATHER_READ_FAILED", { cause: error });
      }

      return data;
    },

    async findByDate(userId, recordedDate) {
      const { data, error } = await supabase
        .from("weather_data")
        .select("*")
        .eq("user_id", userId)
        .eq("recorded_date", recordedDate)
        .maybeSingle();

      if (error) throw new Error("WEATHER_READ_FAILED", { cause: error });
      return data;
    },

    async upsertByDate(userId, input) {
      const { data, error } = await supabase
        .from("weather_data")
        .upsert(
          { ...input, user_id: userId },
          { onConflict: "user_id,recorded_date" },
        )
        .select("*")
        .single();

      if (error || !data) {
        throw new Error("WEATHER_WRITE_FAILED", { cause: error });
      }

      return data;
    },
  };
}
