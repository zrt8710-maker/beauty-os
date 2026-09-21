import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { weatherLocationSearchSchema } from "@/schemas/weather-location";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { WeatherGeocodingError, createOpenMeteoGeocodingProvider } from "@/server/integrations/weather/geocoding";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import { createWeatherLocationService } from "@/server/services/weather-location-service";
import { createOpenMeteoProvider } from "@/server/integrations/weather/open-meteo";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录。" } }, { status: 401, headers });

  try {
    const { searchParams } = new URL(request.url);
    const input = weatherLocationSearchSchema.parse({ query: searchParams.get("query") });
    const supabase = await createClient();
    const service = createWeatherLocationService({
      geocoding: createOpenMeteoGeocodingProvider(),
      profiles: createProfileRepository(supabase),
      weather: createWeatherRepository(supabase),
      provider: createOpenMeteoProvider(),
    });
    return NextResponse.json({ data: await service.search(input) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "请输入城市名称。" } }, { status: 400, headers });
    }
    if (error instanceof WeatherGeocodingError) {
      return NextResponse.json({ error: { code: "LOCATION_SEARCH_FAILED", message: "暂时无法搜索城市，请稍后重试。" } }, { status: 502, headers });
    }
    return NextResponse.json({ error: { code: "LOCATION_SEARCH_FAILED", message: "暂时无法搜索城市，请稍后重试。" } }, { status: 500, headers });
  }
}
