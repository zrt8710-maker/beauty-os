import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { weatherLocationCandidateSchema } from "@/schemas/weather-location";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOpenMeteoGeocodingProvider } from "@/server/integrations/weather/geocoding";
import { WeatherProviderError, createOpenMeteoProvider } from "@/server/integrations/weather/open-meteo";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import { createWeatherLocationService } from "@/server/services/weather-location-service";
import { toWeatherViewModel } from "@/server/weather/weather-presentation";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录。" } }, { status: 401, headers });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "请求内容不是有效的 JSON。" } }, { status: 400, headers });
  }
  try {
    const candidate = weatherLocationCandidateSchema.parse(input);
    const supabase = await createClient();
    const service = createWeatherLocationService({
      geocoding: createOpenMeteoGeocodingProvider(),
      profiles: createProfileRepository(supabase),
      weather: createWeatherRepository(supabase),
      provider: createOpenMeteoProvider(),
    });
    const weather = await service.saveAndRefresh(user.id, candidate);
    return NextResponse.json({ data: toWeatherViewModel(weather, candidate.displayName) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "请选择一个城市。" } }, { status: 400, headers });
    }
    if (error instanceof WeatherProviderError) {
      return NextResponse.json({ error: { code: "WEATHER_REFRESH_FAILED", message: "城市已保存，但今日环境数据暂时无法更新。" } }, { status: 502, headers });
    }
    return NextResponse.json({ error: { code: "WEATHER_REFRESH_FAILED", message: "城市已保存，但今日环境数据暂时无法更新。" } }, { status: 500, headers });
  }
}
