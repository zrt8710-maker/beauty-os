import { describe, expect, it, vi } from "vitest";

import { searchCitiesFromBrowser } from "@/features/weather/open-meteo-browser-search";

describe("browser geocoding fallback", () => {
  it("returns validated city candidates from the same Open-Meteo search", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [
      { name: "成都", admin1: "四川", country: "中国", latitude: 30.66667, longitude: 104.06667, timezone: "Asia/Shanghai" },
    ] }));

    const result = await searchCitiesFromBrowser("成都", fetcher);

    expect(String(fetcher.mock.calls[0]?.[0])).toContain("name=%E6%88%90%E9%83%BD");
    expect(result).toEqual([{ displayName: "成都", region: "四川", country: "中国", latitude: 30.66667, longitude: 104.06667, timezone: "Asia/Shanghai" }]);
  });

  it("rejects malformed coordinates instead of offering an invalid city to save", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [
      { name: "成都", latitude: 130, longitude: 104.06667, timezone: "Asia/Shanghai" },
    ] }));

    await expect(searchCitiesFromBrowser("成都", fetcher)).rejects.toThrow();
  });
});
