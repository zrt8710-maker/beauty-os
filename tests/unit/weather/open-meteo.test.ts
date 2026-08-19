import { describe, expect, it, vi } from "vitest";

import {
  WeatherProviderError,
  createOpenMeteoProvider,
} from "@/server/integrations/weather/open-meteo";

describe("Open-Meteo provider", () => {
  it("将当前天气和今日最高 UV 转换为标准快照", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          current: {
            temperature_2m: 28.4,
            relative_humidity_2m: 71,
            weather_code: 3,
          },
          daily: { time: ["2026-08-18"], uv_index_max: [7.2] },
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenMeteoProvider(fetcher);
    const observation = await provider.getCurrentWeather({
      latitude: 31.23,
      longitude: 121.47,
      timezone: "Asia/Shanghai",
    });

    expect(observation).toEqual(
      expect.objectContaining({
        recordedDate: "2026-08-18",
        temperature: 28.4,
        humidity: 71,
        uvIndex: 7.2,
        weatherCode: "3",
        source: "open_meteo",
      }),
    );
    const requestUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("timezone")).toBe("Asia/Shanghai");
    expect(requestUrl.searchParams.get("forecast_days")).toBe("1");
  });

  it("拒绝非成功响应和结构错误响应", async () => {
    const failed = createOpenMeteoProvider(
      vi.fn().mockResolvedValue(new Response("failed", { status: 503 })),
    );
    const invalid = createOpenMeteoProvider(
      vi.fn().mockResolvedValue(Response.json({ current: {} })),
    );
    const request = {
      latitude: 31.23,
      longitude: 121.47,
      timezone: "Asia/Shanghai",
    };

    await expect(failed.getCurrentWeather(request)).rejects.toEqual(
      new WeatherProviderError(),
    );
    await expect(invalid.getCurrentWeather(request)).rejects.toEqual(
      new WeatherProviderError(),
    );
  });
});
