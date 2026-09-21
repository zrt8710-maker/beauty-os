import type { LongTermSkinBaseline } from "@/schemas/profile";
import type { SkinConversationRequest } from "@/schemas/skin-conversation";

type Concern = "oiliness" | "dryness" | "flaking" | "redness" | "discomfort" | "blemishes" | "small_bumps" | "blackheads" | "visible_pores" | "dullness" | "uneven_tone" | "post_blemish_marks";
type Tendency = LongTermSkinBaseline["recurring_tendencies"][number]["kind"];
type Dimension = "area" | "comparison" | "texture" | "flaking" | "discomfort" | "timing" | "amount";
type Baseline = { usual_oily_areas: string[]; usual_dry_areas: string[]; recurring_tendencies: Array<{ kind: Tendency; usual_areas?: string[] }> };
type BaselineEligibility = { concern: Concern; area: string | null; has_profile_baseline: boolean; has_conversation_baseline: boolean; baseline_unknown: boolean; today_new: boolean; lightweight_advice_eligible: boolean; profile_baseline_areas: string[] };
type ConcernProgress = { concern: Concern; already_asked_dimensions: Dimension[]; already_confirmed_dimensions: Dimension[] };
type ProfileTopic = { concern: Tendency | null; areas: string[]; reason: "relevant_recurring_tendency" | "relevant_goal" };
type ConcernArea = { concern: Concern; area: string | null };

/** Facts and constraints for the provider, not a script for its next reply. */
export type ConversationPriority = {
  today_concerns: Concern[];
  unresolved_user_concerns: Concern[];
  baseline_eligibility: BaselineEligibility[];
  concern_progress: ConcernProgress[];
  eligible_profile_topic: ProfileTopic | null;
  profile_topic_already_discussed: boolean;
  completion: { explicit_user_completion: boolean; generic_completion_allowed: boolean };
  constraints: string[];
};

const topicMatchers: Array<[Concern, RegExp]> = [
  ["oiliness", /出油|油光|油感|油腻|有点油|油/u], ["dryness", /干燥|干紧|紧绷|粗糙|不平整|有点干|干/u], ["flaking", /起皮|脱皮/u], ["redness", /泛红|发红/u], ["discomfort", /刺|痒|灼热|不舒服/u], ["blemishes", /痘|粉刺/u], ["small_bumps", /闭口|小疙瘩|小凸起|小颗粒|颗粒感/u], ["blackheads", /黑头/u], ["visible_pores", /毛孔|毛孔明显/u], ["dullness", /暗沉/u], ["uneven_tone", /肤色不均|不均匀/u], ["post_blemish_marks", /痘印|残留印记/u],
];
const concernForTendency: Partial<Record<Tendency, Concern>> = { flaking: "flaking", redness: "redness", reactive_discomfort: "discomfort", blemishes: "blemishes", small_bumps: "small_bumps", blackheads: "blackheads", visible_pores: "visible_pores", dullness: "dullness", uneven_tone: "uneven_tone", post_blemish_marks: "post_blemish_marks" };

export function deriveConversationPriority(input: Pick<SkinConversationRequest, "message" | "active_turn_context" | "profile_context" | "completion_confirmation_pending">): ConversationPriority {
  const history = input.active_turn_context ?? [];
  const current = topicsFromText(input.message);
  const baseline: Baseline = { usual_oily_areas: input.profile_context?.long_term_skin_baseline?.usual_oily_areas ?? [], usual_dry_areas: input.profile_context?.long_term_skin_baseline?.usual_dry_areas ?? [], recurring_tendencies: input.profile_context?.long_term_skin_baseline?.recurring_tendencies ?? [] };
  const todayConcerns = unique([...history.filter((turn) => turn.startsWith("用户：")).flatMap(topicsFromText), ...current]);
  const turns = [...history, "用户：" + input.message];
  const mentionedAreas = mentionedConcernAreas(turns);
  const answeredAreas = answeredConcernAreas(turns, mentionedAreas);
  const unresolvedAreas = mentionedAreas.filter((item) => !answeredAreas.has(concernAreaKey(item)));
  const unresolved = unique(unresolvedAreas.map((item) => item.concern));
  const profileTopicAlreadyDiscussed = profileTopicWasDiscussed(history, baseline);
  const focus = latestUserConcern(history, current);
  const explicit = explicitCompletion(input.message);
  const profileTopic = !unresolved.length && !profileTopicAlreadyDiscussed && !input.completion_confirmation_pending && !explicit && focus ? unique([focus, ...todayConcerns]).map((concern) => selectProfileTopic(concern, baseline, todayConcerns, input.profile_context?.skin_goals ?? [])).find((topic) => topic !== null) ?? null : null;
  return {
    today_concerns: todayConcerns,
    unresolved_user_concerns: unresolved,
    baseline_eligibility: uniqueEligibility([
      ...current.flatMap((concern) => eligibilityFor(concern, input.message, history, baseline)),
      ...unresolvedAreas.flatMap((item) => eligibilityForArea(item.concern, item.area, history, baseline)),
    ]),
    concern_progress: deriveProgress(turns),
    eligible_profile_topic: profileTopic,
    profile_topic_already_discussed: profileTopicAlreadyDiscussed,
    completion: { explicit_user_completion: explicit, generic_completion_allowed: !unresolved.length && !profileTopic && !input.completion_confirmation_pending },
    constraints: ["Keep every user-mentioned concern in the conversation; do not let Profile erase one.", "Choose wording and order naturally; do not treat this context as a scripted next question.", "Only profile/conversation baselines permit comparison; a missing baseline is unknown, not absent.", "Do not repeat a confirmed dimension under different wording.", "eligible_profile_topic is optional background only; never create a today fact from it."],
  };
}

function eligibilityFor(concern: Concern, message: string, history: string[], baseline: Baseline) {
  const areas = areasForConcern(message, concern);
  const activeQuestion = !areas.length ? [...history].reverse().find((turn) => turn.startsWith("Beauty OS：")) ?? "" : "";
  const activeQuestionAreas = activeQuestion && topicsFromText(activeQuestion).includes(concern) ? areasInText(activeQuestion) : [];
  return (areas.length ? areas : activeQuestionAreas.length ? activeQuestionAreas : [null]).map((area) => eligibilityForArea(concern, area, history, baseline));
}
function eligibilityForArea(concern: Concern, area: string | null, history: string[], baseline: Baseline) {
  const profile = profileBaseline(concern, baseline, area ? [area] : []);
  const conversation = conversationBaseline(concern, area ? [area] : [], history);
  const unknown = !profile.exists && !conversation;
  return { concern, area, has_profile_baseline: profile.exists, has_conversation_baseline: conversation, baseline_unknown: unknown, today_new: unknown, lightweight_advice_eligible: unknown && ["dryness", "flaking", "oiliness", "discomfort"].includes(concern), profile_baseline_areas: profile.areas };
}

function profileBaseline(concern: Concern, baseline: Baseline, currentAreas: string[]) {
  if (concern === "oiliness") return areaMatched(baseline.usual_oily_areas, currentAreas);
  if (concern === "dryness") return areaMatched(baseline.usual_dry_areas, currentAreas);
  const tendency = baseline.recurring_tendencies.find((item) => concernForTendency[item.kind] === concern);
  return tendency ? areaMatched(tendency.usual_areas ?? [], currentAreas) : { exists: false, areas: [] };
}
function areaMatched(baselineAreas: string[], currentAreas: string[]) { return { exists: Boolean(baselineAreas.length && (!currentAreas.length || baselineAreas.some((area) => currentAreas.includes(area)))), areas: baselineAreas }; }
function conversationBaseline(concern: Concern, currentAreas: string[], history: string[]) { return history.filter((turn) => turn.startsWith("用户：")).some((turn) => /平时|往常|通常|一向/u.test(turn) && topicsFromText(turn).includes(concern) && (!currentAreas.length || areasForConcern(turn, concern).some((area) => currentAreas.includes(area)))); }

function selectProfileTopic(focus: Concern, baseline: Baseline, discussed: Concern[], goals: string[]): ProfileTopic | null {
  const relevance: Record<Concern, Tendency[]> = { oiliness: ["blackheads", "visible_pores", "small_bumps", "blemishes"], dryness: ["flaking", "reactive_discomfort", "redness"], flaking: ["reactive_discomfort", "redness"], redness: ["reactive_discomfort"], discomfort: ["reactive_discomfort", "redness"], blemishes: ["small_bumps", "post_blemish_marks"], small_bumps: ["blemishes", "blackheads"], blackheads: ["visible_pores", "small_bumps"], visible_pores: ["blackheads", "small_bumps"], dullness: ["uneven_tone", "post_blemish_marks"], uneven_tone: ["dullness", "post_blemish_marks"], post_blemish_marks: ["blemishes", "uneven_tone"] };
  const tendency = relevance[focus].map((kind) => baseline.recurring_tendencies.find((item) => item.kind === kind)).find((item) => item && !discussed.includes(concernForTendency[item.kind] ?? "dullness"));
  if (tendency) return { concern: tendency.kind, areas: tendency.usual_areas ?? [], reason: "relevant_recurring_tendency" };
  const goalsByConcern: Record<Concern, string[]> = { oiliness: ["oil_control"], dryness: ["hydration", "barrier_support"], flaking: ["hydration", "barrier_support"], redness: ["redness_relief", "barrier_support"], discomfort: ["redness_relief", "barrier_support"], blemishes: ["blemish_care"], small_bumps: ["blemish_care"], blackheads: ["blemish_care"], visible_pores: ["blemish_care"], dullness: ["brightening"], uneven_tone: ["brightening", "dark_spots"], post_blemish_marks: ["dark_spots", "brightening"] };
  return goalsByConcern[focus].some((goal) => goals.includes(goal)) ? { concern: null, areas: [], reason: "relevant_goal" } : null;
}

function mentionedConcernAreas(turns: string[]): ConcernArea[] {
  const known = new Set<Concern>(); const result: ConcernArea[] = [];
  for (const turn of turns) {
    if (!turn.startsWith("用户：")) continue;
    for (const concern of topicsFromText(turn)) {
      const areas = areasForConcern(turn, concern);
      if (areas.length) result.push(...areas.map((area) => ({ concern, area })));
      else if (!known.has(concern)) result.push({ concern, area: null });
      known.add(concern);
    }
  }
  return uniqueConcernAreas(result);
}
function answeredConcernAreas(turns: string[], mentioned: ConcernArea[]) {
  const answered = new Set<string>();
  for (let index = 0; index < turns.length - 1; index += 1) {
    if (!turns[index].startsWith("Beauty OS：") || !turns[index + 1].startsWith("用户：")) continue;
    const concern = topicFromText(turns[index]) ?? concernForQuestionAreas(turns[index], mentioned);
    if (!concern) continue;
    const areas = areasInText(turns[index]);
    for (const item of (areas.length ? areas.map((area) => ({ concern, area })) : mentioned.filter((item) => item.concern === concern))) answered.add(concernAreaKey(item));
  }
  return answered;
}
function concernForQuestionAreas(question: string, mentioned: ConcernArea[]) {
  const areas = new Set(areasInText(question));
  const matches = unique(mentioned.filter((item) => item.area !== null && areas.has(item.area)).map((item) => item.concern));
  return matches.length === 1 ? matches[0] : null;
}
function deriveProgress(turns: string[]) {
  const progress = new Map<Concern, { asked: Dimension[]; confirmed: Dimension[] }>();
  for (let index = 0; index < turns.length; index += 1) { const question = turns[index]; if (!question.startsWith("Beauty OS：")) continue; const concern = topicFromText(question); if (!concern) continue; const item = progress.get(concern) ?? { asked: [], confirmed: [] }; item.asked.push(...questionDimensions(question)); const answer = turns[index + 1]; if (answer?.startsWith("用户：")) item.confirmed.push(...answerDimensions(answer, concern)); progress.set(concern, item); }
  return [...progress.entries()].map(([concern, value]) => ({ concern, already_asked_dimensions: unique(value.asked), already_confirmed_dimensions: unique(value.confirmed) }));
}
function questionDimensions(text: string): Dimension[] { return [/(哪里|部位|区域|T区|脸颊|鼻翼)/u.test(text) ? "area" : null, /(和平时|和平常|比平时|差不多|更明显)/u.test(text) ? "comparison" : null, /(紧绷|粗糙|偏粗|摸起来)/u.test(text) ? "texture" : null, /(起皮|脱皮)/u.test(text) ? "flaking" : null, /(刺痛|发痒|灼热|不舒服)/u.test(text) ? "discomfort" : null, /(什么时候|早上|下午|多久|持续)/u.test(text) ? "timing" : null, /(几颗|多少|数量|一小片)/u.test(text) ? "amount" : null].filter((item): item is Dimension => item !== null); }
function answerDimensions(text: string, concern: Concern): Dimension[] { const result: Dimension[] = []; if (concern === "dryness" && /(紧绷|紧|粗糙|偏粗)/u.test(text)) result.push("texture"); if (/(起皮|脱皮)/u.test(text)) result.push("flaking"); if (/(刺痛|发痒|灼热|不舒服)/u.test(text)) result.push("discomfort"); if (/(早上|下午|晚上|洗完|持续|一会儿)/u.test(text)) result.push("timing"); if (/(T区|额头|鼻子|鼻翼|脸颊|下巴|全脸)/u.test(text)) result.push("area"); if (/^(差不多|更多|更明显|少一点)/u.test(text.trim())) result.push("comparison"); if (/(几颗|很多|一小片)/u.test(text)) result.push("amount"); return result; }

function profileTopicWasDiscussed(history: string[], baseline: Baseline) { const userTopics = new Set<Concern>(); for (const turn of history) { if (turn.startsWith("用户：")) { topicsFromText(turn).forEach((topic) => userTopics.add(topic)); continue; } if (turn.startsWith("Beauty OS：")) { const topic = topicFromText(turn); if (topic && baseline.recurring_tendencies.some((item) => concernForTendency[item.kind] === topic) && !userTopics.has(topic)) return true; } } return false; }
function latestUserConcern(history: string[], current: Concern[]) { if (current.length) return current[0]; for (const turn of [...history].reverse()) { if (!turn.startsWith("用户：")) continue; const topic = topicFromText(turn); if (topic) return topic; } return null; }
function explicitCompletion(message: string) { return /^(没有了|没了|没别的|没有别的|差不多就这些|差不多这些|先这样|可以了|可以整理了|没有其他(?:了)?|没其他(?:了)?|没有更多(?:了)?)[。！!，,\s]*$/u.test(message.trim()); }
function topicsFromText(text: string) { return topicMatchers.filter(([, matcher]) => matcher.test(text)).map(([topic]) => topic); }
function topicFromText(text: string) { return topicsFromText(text)[0] ?? null; }
function areasForConcern(text: string, concern: Concern) { return unique(text.split(/[，,。；;！!？?]/u).filter((part) => topicsFromText(part).includes(concern)).flatMap(areasInText)); }
function areasInText(text: string) { return Object.entries({ t_zone: /T区|T\s*zone/u, forehead: /额头/u, hairline: /发际线/u, nose: /鼻子(?!翼)/u, nose_wings: /鼻翼/u, cheeks: /脸颊/u, chin: /下巴/u, eye_area: /眼周/u, full_face: /全脸/u, other: /局部/u }).filter(([, matcher]) => matcher.test(text)).map(([area]) => area); }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function concernAreaKey(item: ConcernArea) { return `${item.concern}:${item.area ?? ""}`; }
function uniqueConcernAreas(items: ConcernArea[]) { return items.filter((item, index) => items.findIndex((candidate) => concernAreaKey(candidate) === concernAreaKey(item)) === index); }
function uniqueEligibility<T extends { concern: Concern; area: string | null }>(items: T[]) { return items.filter((item, index) => items.findIndex((candidate) => candidate.concern === item.concern && candidate.area === item.area) === index); }
