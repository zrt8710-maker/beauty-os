import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("weather location settings", () => {
  it("exposes city replacement from the global environment entry and reuses the existing location APIs", () => {
    const profilePage = readFileSync(fileURLToPath(new URL("../../../src/app/(app)/profile/page.tsx", import.meta.url)), "utf8");
    const layout = readFileSync(fileURLToPath(new URL("../../../src/app/(app)/layout.tsx", import.meta.url)), "utf8");
    const entry = readFileSync(fileURLToPath(new URL("../../../src/features/weather/sidebar-environment-entry.tsx", import.meta.url)), "utf8");
    const settings = readFileSync(fileURLToPath(new URL("../../../src/features/weather/weather-location-settings.tsx", import.meta.url)), "utf8");

    expect(layout).toContain("SidebarEnvironmentEntry");
    expect(layout).toContain("shell.profileRow?.location_name");
    expect(entry).toContain("WeatherLocationSettings");
    expect(entry).toContain('aria-label="环境与城市设置"');
    expect(entry).toContain("createPortal(");
    expect(entry).toContain("document.body");
    expect(profilePage).not.toContain("WeatherLocationSettings");
    expect(settings).toContain("修改城市");
    expect(settings).toContain("/api/v1/weather/locations?query=");
    expect(settings).toContain("response.status === 502");
    expect(settings).toContain("searchCitiesFromBrowser(value)");
    expect(settings).toContain('fetch("/api/v1/weather/location"');
    expect(settings).toContain("router.refresh()");
    expect(settings).toContain("onSaved?.()");
    expect(settings).toContain("当前城市：{locationName");
    expect(settings).not.toContain("当前经度");
    expect(settings).not.toContain("当前纬度");
  });
});
