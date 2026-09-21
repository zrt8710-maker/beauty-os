import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProfileForm } from "@/features/profile/profile-form";
import { parseProfileSuggestionIntent } from "@/features/profile/profile-suggestion-intent";
import { LongTermBaselineEditor } from "@/features/profile/long-term-baseline-editor";
import {
  baselineLabel,
  sensitivityTendencyLabel,
} from "@/features/profile/profile-presentation";
import type { Profile } from "@/schemas/profile";

const profile: Profile = {
  skin_type: "combination",
  sensitivity_level: 2,
  skin_goals: ["oil_control", "barrier_support"],
  long_term_skin_baseline: { usual_oily_areas: ["t_zone", "nose"], usual_dry_areas: ["nose_wings"], recurring_tendencies: [{ kind: "small_bumps", usual_areas: ["forehead"], tendency: "recurring", usual_intensity: "unknown", source: "user_declared" }, { kind: "blackheads", usual_areas: ["nose"], tendency: "frequent", usual_intensity: "unknown", source: "user_declared" }] },
  preferred_routine_length: { am_steps: 3, pm_steps: 5 },
  texture_preferences: ["lightweight", "gel"],
  avoid_ingredients: ["香精"],
  timezone: "Asia/Shanghai",
  location: { name: "上海", latitude: 31.2304, longitude: 121.4737 },
  onboarding_completed_at: "2026-08-18T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

describe("ProfileForm", () => {
  it("keeps first-time creation focused on the long-term baseline", () => {
    const html = renderToStaticMarkup(
      <ProfileForm initialProfile={{ ...profile, skin_type: null, onboarding_completed_at: null }} />,
    );

    expect(html).toContain("先记录你的平时状态");
    expect(html).toContain("你的皮肤平时更接近哪一种？");
    expect(html).toContain("平时容易出现不舒服吗？");
    expect(html).toContain("刺痛、发痒、灼热或明显刺激感");
    expect(html).toContain("你现在最想长期关注哪些问题？");
    expect(html).toContain("明确想避开的成分或东西");
    expect(html).toContain("平时比较容易出油的是哪里？");
    expect(html).toContain("这些情况你平时会不会反复遇到？");
    expect(html).not.toContain("早间最多步骤");
    expect(html).not.toContain("质地偏好");
    expect(html).not.toContain("IANA 时区");
  });

  it("renders existing values and preferences without a parallel trends report", () => {
    const html = renderToStaticMarkup(
      <ProfileForm initialProfile={profile} />,
    );

    expect(html).not.toContain("你的长期基线");
    expect(html).not.toContain("由你记录的平时状态");
    expect(html).toContain("平时肤质");
    expect(html).toContain("混合");
    expect(html).toContain("比较容易");
    expect(html).toContain("T区、鼻子");
    expect(html).toContain("额头 · 小凸起 / 闭口样颗粒");
    expect(html).toContain("反复出现 · 通常不确定");
    expect(html).toContain("控油");
    expect(html).toContain("香精");
    expect(html).not.toContain("最近皮肤趋势");
    expect(html).not.toContain("查看近期变化");
    expect(html).not.toContain("使用偏好 / 设置");
    expect(html).not.toContain("早间最多步骤");
    expect(html).not.toContain("质地偏好");
    expect(html).not.toContain("evidence_strength");
    expect(html).not.toContain("statements_allowed");
  });

  it("renders independent frequency, usual intensity, and centralized grading anchors in the editor", () => {
    const html = renderToStaticMarkup(<LongTermBaselineEditor onChange={() => undefined} value={profile.long_term_skin_baseline} />);
    expect(html).toContain("多常出现？");
    expect(html).toContain("平时通常有多明显？");
    expect(html).toContain("怎么看这个程度？");
    expect(html).toContain("轻微");
    expect(html).toContain("比较明显");
    expect(html).toContain("黑头怎么看？");
    expect(html).toContain("这是平时通常的程度。");
    expect(html.indexOf("怎么看")).toBeLessThan(html.indexOf("程度参考"));
    expect(html).toContain("一个区域有数个清楚可见黑头");
    expect(html).not.toContain("<details open");
  });

  it("maps stored sensitivity levels to non-technical language without an unknown value", () => {
    expect(baselineLabel("dry")).toBe("偏干");
    expect(baselineLabel("unknown")).toBe("不确定");
    expect(sensitivityTendencyLabel(0)).toBe("基本不会");
    expect(sensitivityTendencyLabel(4)).toBe("非常容易");
  });

  it("opens the existing editor with a suggestion-prefilled draft, not an automatic save", () => {
    const html = renderToStaticMarkup(<ProfileForm initialProfile={profile} suggestionIntent={parseProfileSuggestionIntent({ suggestion: "recurring_tendency", concern: "small_bumps", area: "forehead" })} />);
    expect(html).toContain("编辑长期皮肤档案");
    expect(html).toContain("保存修改");
    expect(html).not.toContain("长期皮肤档案已保存。");
  });
});
