import { describe, expect, it } from "vitest";
import { createVolcengineProfessionalDailyObservationProvider } from "@/server/daily-skin-report/volcengine-professional-daily-observation-provider";

const input = { today: { version: 2 as const, summary: "T区出油", concerns: [] }, profile: { skin_type: "oily" as const, sensitivity_level: 0, skin_goals: ["oil_control" as const], long_term_skin_baseline: { usual_oily_areas: ["t_zone" as const], usual_dry_areas: ["nose_wings" as const], recurring_tendencies: [{ kind: "blackheads" as const, usual_areas: ["nose" as const], tendency: "recurring" as const, frequency: "recurring" as const, usual_intensity: "noticeable" as const, source: "user_declared" as const }] } }, recent_trends: [] };
const valid = { overall_observation: "今天以 T 区出油为主。", baseline_comparison: "与长期基线基本一致。", key_observations: ["T区出油"] };
describe("professional report provider", () => {
  it("parses a valid constrained response", async () => expect(await provider(valid).generate(input)).toEqual(valid));
  it("normalizes the actual Responses output wrapper, harmless extra fields, and formatting before strict parsing", async () => {
    const raw = { ...valid, overall_observation: ` ${valid.overall_observation} `, baseline_comparison: undefined, key_observations: [` ${valid.key_observations[0]} `, null], debug: "not user-facing" };
    const response = { output: [{ content: [{ type: "output_text", text: JSON.stringify(raw) }] }] };
    const client = createVolcengineProfessionalDailyObservationProvider({ apiKey: "k", model: "m", baseUrl: "u", fetchImpl: async () => new Response(JSON.stringify(response), { status: 200 }) });
    await expect(client.generate(input)).resolves.toEqual({ overall_observation: valid.overall_observation, baseline_comparison: null, key_observations: valid.key_observations });
  });
  it("rejects invalid and unsafe responses", async () => { await expect(provider({ ...valid, overall_observation: "屏障受损" }).generate(input)).rejects.toThrow(); await expect(provider({ overall_observation: "x" }).generate(input)).rejects.toThrow(); });
  it("turns timeout and fetch exceptions into provider failures", async () => { await expect(createVolcengineProfessionalDailyObservationProvider({ apiKey: "k", model: "m", baseUrl: "u", fetchImpl: async () => { throw new Error("timeout"); } }).generate(input)).rejects.toThrow("REPORT_PROVIDER_UNAVAILABLE"); });
  it("lets evidence-rich reports use more detail without a fixed sentence target", async () => {
    const rich = { ...valid, overall_observation: "第一句。第二句。第三句。第四句。第五句。", baseline_comparison: "长期肤质提供比较。敏感倾向提供边界。目标提供观察重点。", key_observations: ["观察明天变化。", "观察区域是否重复。", "近期趋势提供连续性。", "证据不足时继续记录。", "观察是否有新伴随感受。"] };
    await expect(provider(rich).generate(input)).resolves.toEqual(rich);
  });
  it("sends validated daily state, profile baseline, and recent trends to the provider", async () => {
    let requestText = "";
    const client = createVolcengineProfessionalDailyObservationProvider({ apiKey: "k", model: "m", baseUrl: "u", fetchImpl: async (_url, init) => { requestText = String(init?.body); return new Response(JSON.stringify({ output_text: JSON.stringify(valid) }), { status: 200 }); } });
    await client.generate({ ...input, recent_trends: [{ title: "T区出油近期反复出现", supporting_line: "过去28天有两次。" }] });
    const body = JSON.parse(requestText) as { input: Array<{ content: Array<{ text: string }> }> };
    const modelInput = JSON.parse(body.input[0].content[0].text);
    expect(modelInput).toMatchObject({ today: input.today, profile: { long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: ["nose_wings"], recurring_tendencies: [expect.objectContaining({ kind: "blackheads", usual_intensity: "noticeable" })] } }, recent_trends: [{ title: "T区出油近期反复出现" }] });
  });
});
function provider(value: unknown) { return createVolcengineProfessionalDailyObservationProvider({ apiKey: "k", model: "m", baseUrl: "u", fetchImpl: async () => new Response(JSON.stringify({ output_text: JSON.stringify(value) }), { status: 200 }) }); }
