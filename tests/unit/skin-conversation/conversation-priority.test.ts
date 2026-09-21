import { describe, expect, it } from "vitest";

import type { SkinConversationRequest } from "@/schemas/skin-conversation";
import { SKIN_ASSESSMENT_FRAMEWORK_PROMPT } from "@/server/skin-conversation/assessment-framework-prompt";
import { deriveConversationPriority } from "@/server/skin-conversation/conversation-priority";

const profile = {
  skin_type: "oily" as const,
  sensitivity_level: 1,
  skin_goals: ["oil_control"] as Array<"oil_control">,
  long_term_skin_baseline: {
    usual_oily_areas: ["t_zone" as const],
    usual_dry_areas: ["nose_wings" as const],
    recurring_tendencies: [
      { kind: "blackheads" as const, usual_areas: ["nose" as const], tendency: "recurring" as const, frequency: "recurring" as const, usual_intensity: "noticeable" as const, source: "user_declared" as const },
      { kind: "small_bumps" as const, usual_areas: ["forehead" as const], tendency: "recurring" as const, source: "user_declared" as const },
    ],
  },
};
const input = (message: string, history: string[] = [], context: SkinConversationRequest["profile_context"] = profile) => ({ message, active_turn_context: history, profile_context: context, completion_confirmation_pending: false });

describe("compact Daily Skin conversation context", () => {
  it("preserves all concerns and keeps cheek and nose-wing dryness semantically separate", () => {
    const priority = deriveConversationPriority(input("T区有点油，脸颊和鼻翼有点干"));
    expect(priority.today_concerns).toEqual(["oiliness", "dryness"]);
    expect(priority.unresolved_user_concerns).toEqual(["oiliness", "dryness"]);
    expect(priority.baseline_eligibility).toEqual(expect.arrayContaining([
      expect.objectContaining({ concern: "oiliness", area: "t_zone", has_profile_baseline: true, baseline_unknown: false, lightweight_advice_eligible: false }),
      expect.objectContaining({ concern: "dryness", area: "nose_wings", has_profile_baseline: true, baseline_unknown: false, lightweight_advice_eligible: false }),
      expect.objectContaining({ concern: "dryness", area: "cheeks", has_profile_baseline: false, baseline_unknown: true, today_new: true, lightweight_advice_eligible: true }),
    ]));
    expect(SKIN_ASSESSMENT_FRAMEWORK_PROMPT).toContain("baseline_unknown means today-new, not absent");
    expect(SKIN_ASSESSMENT_FRAMEWORK_PROMPT).toContain("do not force another round");
  });

  it("does not authorize cheek comparison from a nose-wing baseline", () => {
    const priority = deriveConversationPriority(input("脸颊有点干"));
    expect(priority.baseline_eligibility).toEqual([expect.objectContaining({ concern: "dryness", area: "cheeks", has_profile_baseline: false, baseline_unknown: true })]);
  });

  it.each([
    ["blackheads", "nose", "鼻子有黑头"],
    ["small_bumps", "forehead", "额头有小颗粒"],
    ["blemishes", "chin", "下巴长痘"],
    ["redness", "cheeks", "脸颊有点泛红"],
    ["reactive_discomfort", "cheeks", "脸颊有点刺痛"],
    ["flaking", "nose_wings", "鼻翼起皮"],
    ["visible_pores", "nose", "鼻子毛孔明显"],
  ] as const)("uses matching concern + area semantics for %s", (kind, area, message) => {
    const context = {
      skin_type: "normal" as const,
      sensitivity_level: 1,
      skin_goals: [],
      long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [{ kind, usual_areas: [area], tendency: "recurring" as const, frequency: "recurring" as const, usual_intensity: "noticeable" as const, source: "user_declared" as const }] },
    } as SkinConversationRequest["profile_context"];
    const known = deriveConversationPriority(input(message, [], context));
    expect(known.baseline_eligibility).toEqual([expect.objectContaining({ area, has_profile_baseline: true, baseline_unknown: false, lightweight_advice_eligible: false })]);
    const unknown = deriveConversationPriority(input(message.replace(/鼻子|额头|下巴|脸颊|鼻翼/u, "全脸"), [], context));
    expect(unknown.baseline_eligibility).toEqual([expect.objectContaining({ area: "full_face", has_profile_baseline: false, baseline_unknown: true, today_new: true })]);
  });

  it("keeps a today-new cheek eligible after the user answers its observable follow-up", () => {
    const priority = deriveConversationPriority(input("摸起来粗糙", ["用户：T区有点油，脸颊和鼻翼有点干", "Beauty OS：脸颊这块是今天新提到的。现在更像摸起来粗糙、觉得紧绷，还是有起皮？"]));
    expect(priority.baseline_eligibility).toEqual(expect.arrayContaining([
      expect.objectContaining({ concern: "dryness", area: "cheeks", baseline_unknown: true, today_new: true, lightweight_advice_eligible: true }),
      expect.objectContaining({ concern: "dryness", area: "nose_wings", has_profile_baseline: true, baseline_unknown: false, lightweight_advice_eligible: false }),
      expect.objectContaining({ concern: "oiliness", area: "t_zone", has_profile_baseline: true, baseline_unknown: false }),
    ]));
    expect(priority.unresolved_user_concerns).toEqual(["oiliness", "dryness"]);
  });

  it("does not allow generic completion to skip the one Profile topic after all mentioned areas are answered", () => {
    const history = ["用户：T区有点油，脸颊和鼻翼有点干", "Beauty OS：脸颊这块是今天新提到的。现在更像粗糙、紧绷还是起皮？", "用户：粗糙", "Beauty OS：鼻翼今天和平时通常的程度差不多，还是更明显？", "用户：差不多", "Beauty OS：今天T区出油和平时比，差不多还是更明显？"];
    const priority = deriveConversationPriority(input("差不多", history));
    expect(priority.unresolved_user_concerns).toEqual([]);
    expect(priority.eligible_profile_topic).toEqual({ concern: "blackheads", areas: ["nose"], reason: "relevant_recurring_tendency" });
    expect(priority.completion.generic_completion_allowed).toBe(false);
  });

  it("uses an explicit conversation baseline without turning it into a today fact", () => {
    const priority = deriveConversationPriority(input("今天脸颊有点干", ["用户：我平时脸颊不干"]));
    expect(priority.baseline_eligibility).toEqual([expect.objectContaining({ concern: "dryness", area: "cheeks", has_conversation_baseline: true, baseline_unknown: false })]);
    expect(priority).not.toHaveProperty("daily_state");
  });

  it("keeps confirmed roughness from being asked again", () => {
    const priority = deriveConversationPriority(input("粗糙", ["用户：脸颊有点干", "Beauty OS：脸颊这边更像紧绷、粗糙还是起皮？"]));
    expect(priority.concern_progress).toEqual(expect.arrayContaining([expect.objectContaining({ concern: "dryness", already_confirmed_dimensions: ["texture"] })]));
    expect(SKIN_ASSESSMENT_FRAMEWORK_PROMPT).toContain("do not mechanically fill every remaining field");
  });

  it("offers one relevant Profile topic only after user concerns are handled", () => {
    const history = ["用户：T区有点油，脸颊和鼻翼有点干", "Beauty OS：今天出油和平时比呢？", "用户：差不多", "Beauty OS：脸颊和鼻翼干这边具体是什么感觉？", "用户：鼻翼差不多，脸颊有点粗糙"];
    const priority = deriveConversationPriority(input("就是这些表现", history));
    expect(priority.unresolved_user_concerns).toEqual([]);
    expect(priority.eligible_profile_topic).toEqual({ concern: "blackheads", areas: ["nose"], reason: "relevant_recurring_tendency" });
    expect(priority.completion.generic_completion_allowed).toBe(false);
  });

  it("allows generic completion only when no Profile topic is eligible", () => {
    const noExtraProfile = { ...profile, skin_goals: [], long_term_skin_baseline: { ...profile.long_term_skin_baseline, recurring_tendencies: [] } };
    const priority = deriveConversationPriority(input("差不多", ["用户：T区有点油", "Beauty OS：今天出油和平时比呢？"], noExtraProfile));
    expect(priority.eligible_profile_topic).toBeNull();
    expect(priority.completion.generic_completion_allowed).toBe(true);
  });

  it("contains constraints rather than a forced active concern or question template", () => {
    const priority = deriveConversationPriority(input("T区有点油，脸颊有点干"));
    expect(priority).not.toHaveProperty("active_concern");
    expect(priority).not.toHaveProperty("pending_concerns");
    expect(priority.eligible_profile_topic === null || priority.eligible_profile_topic).toBeTruthy();
    if (priority.eligible_profile_topic) expect(priority.eligible_profile_topic).not.toHaveProperty("question");
    expect(priority.constraints.join(" ")).toContain("as a scripted next question");
    expect(SKIN_ASSESSMENT_FRAMEWORK_PROMPT).toContain("compact, non-persistent context—not a script");
    expect(SKIN_ASSESSMENT_FRAMEWORK_PROMPT).toContain("If clarification would materially help");
    expect(SKIN_ASSESSMENT_FRAMEWORK_PROMPT).toContain("do not impose a fixed area");
    expect(SKIN_ASSESSMENT_FRAMEWORK_PROMPT).toContain("optional background, not a conversation obligation");
  });
});
