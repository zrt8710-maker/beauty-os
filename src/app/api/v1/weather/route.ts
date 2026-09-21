import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  WeatherProviderError,
  createOpenMeteoProvider,
} from "@/server/integrations/weather/open-meteo";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import {
  WeatherLocationRequiredError,
  createWeatherService,
  toWeatherData,
} from "@/server/services/weather-service";
import { getOrRefreshTodayWeather } from "@/server/services/today-weather-service";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[] | undefined>,
) {
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status, headers: noStoreHeaders },
  );
}

async function getRequestContext() {
  const user = await getCurrentUser();

  if (!user) return null;

  const supabase = await createClient();
  const weather = createWeatherRepository(supabase);
  const profiles = createProfileRepository(supabase);
  const provider = createOpenMeteoProvider();

  return {
    user,
    weather,
    profiles,
    provider,
    service: createWeatherService(weather, profiles, provider),
  };
}

function logWeatherReadFailure(error: unknown) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const zodIssues = error instanceof ZodError
    ? error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }))
    : undefined;
  console.error("[weather] today snapshot read failed", {
    errorName: error instanceof Error ? error.name : typeof error,
    causeName: cause?.name,
    zodIssues,
    ...(process.env.NODE_ENV === "development"
      ? {
          errorMessage: error instanceof Error ? error.message : "Unknown weather read failure",
          causeMessage: cause?.message,
        }
      : {}),
  });
}

export async function GET() {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  try {
    const weather = await getOrRefreshTodayWeather({
      userId: context.user.id,
      profiles: context.profiles,
      weather: context.weather,
      provider: context.provider,
    });
    return NextResponse.json({ data: weather ? toWeatherData(weather) : null }, { headers: noStoreHeaders });
  } catch (error) {
    logWeatherReadFailure(error);
    return errorResponse(500, "WEATHER_READ_FAILED", "无法读取天气数据。");
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }

  try {
    const weather = await context.service.refreshWeather(context.user.id, input);
    return NextResponse.json({ data: weather }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "天气请求内容不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    if (error instanceof WeatherLocationRequiredError) {
      return errorResponse(
        409,
        "WEATHER_LOCATION_REQUIRED",
        "请先在皮肤档案中填写经纬度和时区。",
      );
    }

    if (error instanceof WeatherProviderError) {
      return errorResponse(502, "WEATHER_PROVIDER_FAILED", "暂时无法获取天气数据。");
    }

    return errorResponse(500, "WEATHER_WRITE_FAILED", "无法保存天气数据。");
  }
}
