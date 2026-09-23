import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CarePreferencesForm } from "@/features/profile/care-preferences-form";
import type { Profile } from "@/schemas/profile";

const profile: Profile = {
  skin_type: "combination",
  sensitivity_level: 2,
  skin_goals: ["barrier_support"],
  long_term_skin_baseline: {
    usual_oily_areas: ["t_zone"],
    usual_dry_areas: [],
    recurring_tendencies: [],
  },
  preferred_routine_length: { am_steps: 3, pm_steps: 5 },
  texture_preferences: ["lightweight", "gel"],
  avoid_ingredients: ["香精"],
  timezone: "Asia/Shanghai",
  location: { name: "成都", latitude: 30.5728, longitude: 104.0668 },
  onboarding_completed_at: "2026-08-18T00:00:00.000Z",
  updated_at: "2026-09-18T00:00:00.000Z",
};

describe("CarePreferencesForm", () => {
  it("renders only existing routine-level Profile preferences", () => {
    const html = renderToStaticMarkup(
      <CarePreferencesForm initialProfile={profile} />,
    );

    expect(html).toContain("早间最多步骤");
    expect(html).toContain('value="3"');
    expect(html).toContain("晚间最多步骤");
    expect(html).toContain('value="5"');
    expect(html).toContain("质地偏好");
    expect(html).toContain("轻薄");
    expect(html).toContain("啫喱");
    expect(html).toContain("保存护理偏好");
    expect(html).not.toContain("避用成分");
    expect(html).not.toContain("长期皮肤基线");
  });
});
