import type { SkinConversationRequest } from "@/schemas/skin-conversation";

export type ActiveQuestionContext = { active_concern: "oiliness" | "dryness" | "flaking" | "redness" | "stinging" | "itching" | "burning" | "blemishes" | "small_bumps" | "blackheads" | null; asked_dimension: "area" | "timing" | "severity" | "amount" | "absence" | "duration" | null; assistant_question: string | null; known_facts_so_far: unknown };
export type DeterministicShortAnswer = { kind: "area" | "timing" | "severity" | "amount" | "absence" | "duration"; value: string; expanded: string };

const concernMatchers = [["出油", "oiliness"], ["起皮", "flaking"], ["干", "dryness"], ["泛红", "redness"], ["刺痛", "stinging"], ["发痒", "itching"], ["灼热", "burning"], ["闭口", "small_bumps"], ["黑头", "blackheads"], ["痘", "blemishes"]] as const;
const areas: Record<string, string> = { "T区": "t_zone", "鼻子": "nose", "脸颊": "cheeks", "额头": "forehead", "下巴": "chin" };

export function deriveActiveQuestionContext(input: Pick<SkinConversationRequest, "active_turn_context" | "existing_checkin">): ActiveQuestionContext {
  const question = [...(input.active_turn_context ?? [])].reverse().find((turn) => turn.startsWith("Beauty OS："))?.replace(/^Beauty OS：/, "") ?? null;
  const concern = question ? concernMatchers.find(([word]) => question.includes(word))?.[1] ?? null : null;
  const dimension = !question ? null : /哪些部位|哪里|哪一块|集中在/.test(question) ? "area" : /什么时候|早上|下午|时段/.test(question) ? "timing" : /几颗|多少|数量/.test(question) ? "amount" : /有没有|是否|(?:有|无).*(?:痒|刺痛|疼|泛红|不适)/.test(question) ? "absence" : /持续|多久|一会儿/.test(question) ? "duration" : /一点|明显|程度|严重/.test(question) ? "severity" : null;
  return { active_concern: concern, asked_dimension: dimension, assistant_question: question, known_facts_so_far: input.existing_checkin?.daily_state ?? null };
}

export function parseDeterministicShortAnswer(message: string, context: ActiveQuestionContext): DeterministicShortAnswer | null {
  const text = message.trim();
  if (!context.active_concern || !context.asked_dimension) return null;
  if (context.asked_dimension === "area" && areas[text]) return { kind: "area", value: areas[text], expanded: `${text}${label(context.active_concern)}。` };
  if (context.asked_dimension === "timing" && /^(下午|早上就有|洗完脸后|晚上明显)$/.test(text)) return { kind: "timing", value: text, expanded: `${label(context.active_concern)}在${text}更明显。` };
  if (context.asked_dimension === "severity" && /^(一点点|中等|很明显|比平时严重一点)$/.test(text)) return { kind: "severity", value: text, expanded: `${label(context.active_concern)}${text}。` };
  if (context.asked_dimension === "amount" && (/^[一二三四五六七八九十\d]+颗$/.test(text) || /^(很多|一小片)$/.test(text))) return { kind: "amount", value: text, expanded: `有${text}${label(context.active_concern)}。` };
  if (context.asked_dimension === "absence" && /^(没有|没有了|不痒|不疼|没泛红)$/.test(text)) return { kind: "absence", value: text, expanded: `明确没有${label(context.active_concern)}。` };
  if (context.asked_dimension === "duration" && /^(一会儿就好了|持续半天|这几天都有)$/.test(text)) return { kind: "duration", value: text, expanded: `${label(context.active_concern)}${text}。` };
  return null;
}

function label(concern: NonNullable<ActiveQuestionContext["active_concern"]>) { return { oiliness: "出油", dryness: "干燥", flaking: "起皮", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "痘痘", small_bumps: "闭口", blackheads: "黑头" }[concern]; }
