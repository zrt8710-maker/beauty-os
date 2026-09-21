import { describe, expect, it, vi } from "vitest";

import { createOpenMeteoGeocodingProvider } from "@/server/integrations/weather/geocoding";

describe("Open-Meteo geocoding", () => {
  it("returns selectable candidates and never selects one itself", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [
      { name: "上海", admin1: "上海市", country: "中国", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" },
      { name: "上海", admin1: "四川省", country: "中国", latitude: 30.99, longitude: 103.6, timezone: "Asia/Shanghai" },
    ] }));
    const candidates = await createOpenMeteoGeocodingProvider(fetcher).searchCities("上海");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ displayName: "上海", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" });
  });
});
