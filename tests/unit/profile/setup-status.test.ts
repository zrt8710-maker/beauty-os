import { describe, expect, it } from "vitest";

import { getSetupStatus } from "@/features/profile/setup-status";

const row = {
  onboarding_completed_at: null,
  location_name: null,
  latitude: null,
  longitude: null,
  max_am_steps: 4,
  max_pm_steps: 5,
  preferences: {},
};

describe("first-use setup status", () => {
  it("keeps independent reminders for an unconfigured account", () => {
    expect(getSetupStatus(row)).toEqual({ profile: false, city: false, preferences: false });
  });

  it("clears each reminder from saved account data, including an explicit save of default preferences", () => {
    expect(getSetupStatus({ ...row, onboarding_completed_at: "2026-09-24T00:00:00Z" })).toEqual({ profile: true, city: false, preferences: false });
    expect(getSetupStatus({ ...row, location_name: "成都", latitude: 30.57, longitude: 104.06 })).toEqual({ profile: false, city: true, preferences: false });
    expect(getSetupStatus({ ...row, preferences: { care_preferences_saved_at: "2026-09-24T00:00:00Z" } })).toEqual({ profile: false, city: false, preferences: true });
  });
});
