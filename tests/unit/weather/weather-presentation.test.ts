import { describe, expect, it } from "vitest";

import { formatWeatherCondition, toWeatherViewModel } from "@/server/weather/weather-presentation";

describe("weather presentation", () => {
  it("maps known WMO codes without exposing the raw code", () => {
    expect(formatWeatherCondition("2")).toBe("多云");
    expect(formatWeatherCondition("95")).toBe("雷雨");
    expect(formatWeatherCondition("999")).toBeNull();
  });

  it("creates the lightweight environment view model", () => {
    expect(toWeatherViewModel({ recorded_date: "2026-09-05", temperature: 28, humidity: 71, uv_index: 7.2, weather_code: "3" }, "上海")).toEqual({
      recorded_date: "2026-09-05", location_label: "上海", temperature_c: 28,
      humidity_percent: 71, uv_index: 7.2, condition: "阴",
    });
  });
});
