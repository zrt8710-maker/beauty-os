import { describe, expect, it, vi } from "vitest";

import { createProfessionalDailyObservationService } from "@/server/daily-skin-report/professional-daily-observation-service";
import { createVolcengineProfessionalDailyObservationProvider } from "@/server/daily-skin-report/volcengine-professional-daily-observation-provider";

const input = {
  today: { version: 2 as const, summary: "鼻子有些出油", concerns: [{ kind: "oiliness" as const, status: "present" as const, areas: ["nose" as const], attributes: {}, user_wording: ["鼻子有些出油"], source: ["manual" as const] }] },
  profile: { skin_type: "oily" as const, sensitivity_level: 2, skin_goals: ["oil_control" as const], long_term_skin_baseline: { usual_oily_areas: ["nose" as const], usual_dry_areas: [], recurring_tendencies: [] } },
  recentTrends: [{ title: "出油近期重复记录", supporting_line: "过去记录中有重复观察。" }],
};

describe("ProfessionalDailyObservationService", () => {
  it("passes today, all profile baseline fields, and deterministic trends to the provider", async () => {
    const generate = vi.fn().mockResolvedValue(report());
    await expect(createProfessionalDailyObservationService({ generate }).generate(input)).resolves.toEqual(report());
    expect(generate).toHaveBeenCalledWith({ today: input.today, profile: input.profile, recent_trends: input.recentTrends, presentation_mode: "daily_overview" });
  });

  it.each([new Error("timeout"), { overall_observation: "missing fields" }])("falls back when the provider fails or returns an invalid report", async (result) => {
    const generate = vi.fn().mockImplementation(async () => { if (result instanceof Error) throw result; return result; });
    const observation = await createProfessionalDailyObservationService({ generate }).generate(input);
    expect(observation.overall_observation).toContain("鼻子出油");
    expect(observation.key_observations).not.toContain("oiliness");
  });

  it("keeps rich evidence, profile context, and deterministic trend context without repeating their jobs", async () => {
    const rich = {
      today: { version: 2 as const, summary: "今天T区早上轻微出油，下午更明显；脸颊轻微出油，鼻翼有一点干。", concerns: [
        { kind: "oiliness" as const, status: "present" as const, areas: ["t_zone" as const, "cheeks" as const], attributes: { severity: "moderate" as const, duration: "part_day" as const }, user_wording: ["下午更油"], source: ["conversation" as const] },
        { kind: "dryness" as const, status: "present" as const, areas: ["nose_wings" as const], attributes: { severity: "slight" as const }, user_wording: ["鼻翼有点干"], source: ["conversation" as const] },
        { kind: "itching" as const, status: "absent" as const, areas: ["full_face" as const], attributes: {}, user_wording: ["不痒"], source: ["conversation" as const] },
        { kind: "stinging" as const, status: "absent" as const, areas: ["full_face" as const], attributes: {}, user_wording: ["不刺痛"], source: ["conversation" as const] },
      ] },
      profile: { skin_type: "oily" as const, sensitivity_level: 1, skin_goals: ["oil_control" as const, "hydration" as const], long_term_skin_baseline: { usual_oily_areas: ["t_zone" as const], usual_dry_areas: ["nose_wings" as const], recurring_tendencies: [] } },
      recentTrends: [{ title: "出油近期重复记录", supporting_line: "T区出油已经多次出现，今天延续了这一模式。" }],
    };
    const observation = await createProfessionalDailyObservationService({ generate: async () => { throw new Error("timeout"); } }).generate(rich);
    expect(observation.overall_observation).toContain("鼻翼");
    expect(observation.overall_observation).toContain("没有记录到发痒、刺痛");
    expect(observation.baseline_comparison).toContain("偏油");
    expect(observation.baseline_comparison).toContain("敏感倾向");
    expect(observation.baseline_comparison).toContain("控油");
    expect(observation.key_observations.join("\n")).toContain("多次出现");
    expect(observation.key_observations.join("\n")).toContain("暂时不能判断");
    expect(observation.key_observations).toHaveLength(4);
  });

  it("keeps sparse evidence concise", async () => {
    const observation = await createProfessionalDailyObservationService(null).generate(input);
    expect(observation.overall_observation.length).toBeLessThan(140);
    expect(observation.key_observations.length).toBeLessThanOrEqual(4);
  });

  it("keeps the strict report contract valid even when a saved daily state has only a summary", async () => {
    const observation = await createProfessionalDailyObservationService(null).generate({ ...input, today: { version: 2, summary: "今天感觉一般。", concerns: [] } });
    expect(observation.key_observations).toHaveLength(1);
    expect(observation.key_observations[0]).toContain("后续");
  });

  it("falls back to a valid report when the provider rejects an invalid raw structured payload", async () => {
    const provider = createVolcengineProfessionalDailyObservationProvider({ apiKey: "k", model: "m", baseUrl: "u", fetchImpl: async () => new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify({ overall_observation: "only one field" }) }] }] }), { status: 200 }) });
    const observation = await createProfessionalDailyObservationService(provider).generate(input);
    expect(observation.overall_observation).toContain("鼻子出油");
    expect(observation.key_observations.length).toBeGreaterThan(0);
  });

  it("keeps a regional mixed pattern, baseline comparison, new area, and unchanged tendency distinct in the fallback", async () => {
    const fixture = {
      today: { version: 2 as const, summary: "", concerns: [
        { kind: "oiliness" as const, status: "present" as const, areas: ["t_zone" as const], attributes: { severity: "mild" as const, duration: "part_day" as const, baseline_comparison: "usual" as const }, user_wording: ["下午更明显"], source: ["conversation" as const] },
        { kind: "dryness" as const, status: "present" as const, areas: ["cheeks" as const], attributes: { baseline_comparison: "new" as const }, user_wording: ["脸颊摸起来粗糙"], source: ["conversation" as const] },
        { kind: "dryness" as const, status: "present" as const, areas: ["nose_wings" as const], attributes: { baseline_comparison: "usual" as const }, user_wording: ["鼻翼干和平时差不多"], source: ["conversation" as const] },
        { kind: "blackheads" as const, status: "present" as const, areas: ["nose" as const], attributes: { baseline_comparison: "usual" as const }, user_wording: ["黑头没变化"], source: ["conversation" as const] },
      ] },
      profile: { skin_type: "oily" as const, sensitivity_level: 1, skin_goals: ["oil_control" as const], long_term_skin_baseline: { usual_oily_areas: ["t_zone" as const], usual_dry_areas: ["nose_wings" as const], recurring_tendencies: [{ kind: "blackheads" as const, usual_areas: ["nose" as const], tendency: "recurring" as const, frequency: "recurring" as const, usual_intensity: "noticeable" as const, source: "user_declared" as const }, { kind: "small_bumps" as const, usual_areas: ["forehead" as const], tendency: "recurring" as const, frequency: "recurring" as const, usual_intensity: "noticeable" as const, source: "user_declared" as const }] } },
      recentTrends: [],
    };
    const report = await createProfessionalDailyObservationService(null).generate(fixture);
    expect(report.overall_observation).toContain("分区不完全一致");
    expect(report.overall_observation).toContain("T区");
    expect(report.baseline_comparison).toContain("T区");
    expect(report.baseline_comparison).toContain("鼻翼");
    expect(report.baseline_comparison).toContain("脸颊");
    expect(report.baseline_comparison).toContain("黑头");
    expect(report.key_observations.join("\n")).toContain("脸颊");
    expect(report.overall_observation).not.toContain("小凸起");
  });
});

function report() {
  return { overall_observation: "今天以鼻子出油为主。", baseline_comparison: "与长期状态相比，今天以本次记录为准。", key_observations: ["鼻子的出油值得留意。"] };
}
