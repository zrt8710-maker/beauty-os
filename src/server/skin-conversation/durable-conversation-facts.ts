import type {
  DailyState,
  DailyStateArea,
  DailyStateConcern,
  DailyStateConcernKind,
  SkinCheckinField,
} from "@/schemas/checkin";
import { gradeDailySkinConcern } from "@/domain/skin-grading/skin-grading-mapper";

type V2DailyState = Extract<DailyState, { version: 2 }>;

const concernMatchers: Array<[DailyStateConcernKind, RegExp]> = [
  ["oiliness", /出油|油光|油感|油腻|有点油|很油/u],
  ["flaking", /起皮|脱皮/u],
  ["roughness", /粗糙|不平整/u],
  ["dryness", /干燥|发干|有点干|很干|紧绷/u],
  ["redness", /泛红|发红/u],
  ["stinging", /刺痛|刺疼/u],
  ["itching", /发痒|瘙痒|很痒/u],
  ["burning", /灼热|灼痛|烧灼/u],
  ["small_bumps", /闭口|小颗粒|小凸起|小疙瘩/u],
  ["blackheads", /黑头/u],
  ["blemishes", /长痘|痘痘|粉刺/u],
  ["visible_pores", /毛孔(?:明显|粗大)?/u],
  ["uneven_tone", /肤色不均|肤色不匀|色差/u],
  ["dullness", /暗沉|肤色暗|没光泽/u],
  ["post_blemish_marks", /痘印|残留印记|痘后色沉/u],
];

const absenceMatchers: Partial<Record<DailyStateConcernKind, RegExp>> = {
  oiliness: /(?:没有|没|无)(?:明显)?(?:出油|油光|油感)|不油/u,
  dryness: /(?:没有|没|无)(?:干燥|发干|紧绷)|不干/u,
  flaking: /(?:没有|没|无)(?:起皮|脱皮)|不起皮/u,
  roughness: /(?:没有|没|无)(?:粗糙|不平整)|不粗糙/u,
  redness: /(?:没有|没|无)(?:泛红|发红)|不红/u,
  stinging: /(?:没有|没|无)(?:刺痛|刺疼)|不刺痛/u,
  itching: /(?:没有|没|无)(?:发痒|瘙痒|痒)|不痒/u,
  burning: /(?:没有|没|无)(?:灼热|灼痛|烧灼)|不灼热/u,
  blemishes: /(?:没有|没|无)(?:长痘|痘痘|粉刺)|不长痘/u,
  small_bumps: /(?:没有|没|无)(?:闭口|小颗粒|小凸起|小疙瘩)/u,
  blackheads: /(?:没有|没|无)黑头/u,
  visible_pores: /(?:没有|没|无)明显毛孔|毛孔不明显/u,
  uneven_tone: /(?:没有|没|无)肤色不(?:均|匀)/u,
  dullness: /(?:没有|没|无)暗沉|不暗沉/u,
  post_blemish_marks: /(?:没有|没|无)(?:痘印|残留印记|痘后色沉)/u,
};

const areaMatchers: Array<[DailyStateArea, RegExp]> = [
  ["t_zone", /T\s*区/u],
  ["forehead", /额头/u],
  ["hairline", /发际线/u],
  ["nose_wings", /鼻翼/u],
  ["nose", /鼻子(?!翼)/u],
  ["cheeks", /脸颊|面颊/u],
  ["chin", /下巴/u],
  ["eye_area", /眼周/u],
  ["full_face", /全脸|整脸|整张脸/u],
];

const uncertainStatement = /不知道|不确定|说不准|没注意|不太会判断|算不算/u;
const completionOnly = /^(没有了|没了|没别的|没有别的|就这些|差不多了|差不多就这些|先这样|可以了|可以整理了|没有其他(?:了)?|没其他(?:了)?|没有更多(?:了)?)[。！!，,\s]*$/u;

type NormalDayEvidence = { user_statements: string[] } | null | undefined;

/**
 * Finalize-only recovery boundary. It reads only user-authored transcript text
 * and emits the smallest facts directly supported by that text. It does not
 * infer absent concerns, grades, or Profile facts from silence.
 */
export function deriveDurableConversationFacts(activeTurnContext: string[]): V2DailyState {
  const concerns = new Map<string, DailyStateConcern>();
  for (const entry of activeTurnContext) {
    if (!entry.startsWith("用户：")) continue;
    const message = entry.slice(3).trim();
    if (!message || completionOnly.test(message)) continue;
    for (const clause of message.split(/[，,。；;！!？?]/u).map((item) => item.trim()).filter(Boolean)) {
      for (const [kind, matcher] of concernMatchers) {
        if (!matcher.test(clause)) continue;
        const absent = absenceMatchers[kind]?.test(clause) ?? false;
        if (!absent && uncertainStatement.test(clause)) continue;
        const areas = areasIn(clause);
        const concern: DailyStateConcern = {
          kind,
          status: absent ? "absent" : "present",
          areas: areas.length ? areas : ["other"],
          attributes: absent ? {} : attributesFrom(clause, kind, areas),
          user_wording: [clause.slice(0, 120)],
          source: ["conversation"],
          interaction_origin: "user_raised",
          area_origin: areas.length ? "user_confirmed" : "unknown",
        };
        concerns.set(`${kind}:${concern.areas.join(",")}`, concern);
      }
    }
  }
  return {
    version: 2,
    summary: concerns.size ? "已根据完整对话保留今天确认的皮肤事实。" : null,
    concerns: [...concerns.values()],
  };
}

export function validateNormalDayEvidence(evidence: NormalDayEvidence, activeTurnContext: string[]) {
  const available = new Set(activeTurnContext.flatMap((entry) => entry.startsWith("用户：") ? [normalizeStatement(entry.slice(3))] : []));
  const cited = new Set(evidence?.user_statements.map(normalizeStatement) ?? []);
  const grounded = cited.size > 0 && [...cited].every((statement) => available.has(statement) && !completionOnly.test(statement) && !uncertainStatement.test(statement));
  const transcript = deriveDurableConversationFacts(activeTurnContext);
  return {
    grounded,
    contradicted: transcript.concerns.some((concern) => concern.status === "present"),
    groundedStatements: grounded ? cited : new Set<string>(),
  };
}

export function hasUnresolvedSubstantiveConversationInput(activeTurnContext: string[], resolvedNormalDayStatements: ReadonlySet<string> = new Set()) {
  return activeTurnContext.some((entry) => {
    if (!entry.startsWith("用户：")) return false;
    const message = normalizeStatement(entry.slice(3));
    if (!message || completionOnly.test(message) || resolvedNormalDayStatements.has(message)) return false;
    return deriveDurableConversationFacts([entry]).concerns.length === 0;
  });
}

export function mergeProviderAndTranscriptFacts(
  providerState: DailyState | null,
  activeTurnContext: string[],
  groundedNormalDay = false,
): DailyState | null {
  const transcript = deriveDurableConversationFacts(activeTurnContext);
  if (providerState?.version === 1) return providerState;
  const provider = providerState?.version === 2 ? providerState : null;
  if (!provider && transcript.concerns.length === 0) {
    return groundedNormalDay ? { version: 2, summary: "今天没有补充特别的皮肤变化。", concerns: [] } : null;
  }
  const providerConcerns = provider?.concerns ?? [];
  const providerKinds = new Set(providerConcerns.map((concern) => concern.kind));
  const concerns = [
    ...providerConcerns,
    ...transcript.concerns.filter((concern) => !providerKinds.has(concern.kind)),
  ];
  return {
    version: 2,
    summary: provider?.summary ?? transcript.summary ?? (groundedNormalDay ? "今天没有补充特别的皮肤变化。" : null),
    concerns,
  };
}

function normalizeStatement(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

/** Canonical fields are filled only when the existing grading contract can grade a durable fact. */
export function canonicalPatchFromDailyState(
  state: DailyState | null,
): Partial<Record<SkinCheckinField, number>> {
  if (state?.version !== 2) return {};
  const patch: Partial<Record<SkinCheckinField, number>> = {};
  for (const concern of state.concerns) {
    const field = canonicalFieldFor(concern);
    if (!field) continue;
    const grade = gradeDailySkinConcern(concern);
    if (grade.status !== "graded") continue;
    patch[field] = Math.max(patch[field] ?? 0, grade.grade);
  }
  return patch;
}

function canonicalFieldFor(concern: DailyStateConcern): SkinCheckinField | null {
  if (concern.kind === "oiliness") return "oiliness_level";
  if (concern.kind === "dryness") return "dryness_level";
  if (concern.kind === "redness") return "redness_level";
  if (concern.kind === "blemishes") return "acne_level";
  if (["stinging", "itching", "burning"].includes(concern.kind) && concern.status === "present") {
    return "sensitivity_level";
  }
  return null;
}

function areasIn(text: string): DailyStateArea[] {
  return areaMatchers.filter(([, matcher]) => matcher.test(text)).map(([area]) => area);
}

function attributesFrom(text: string, kind: DailyStateConcernKind, areas: DailyStateArea[]): DailyStateConcern["attributes"] {
  const attributes: DailyStateConcern["attributes"] = {};
  if (/一点点|有点|轻微|稍微/u.test(text)) attributes.severity = "slight";
  else if (/很明显|特别明显|很严重|严重/u.test(text)) attributes.severity = "marked";
  else if (/明显/u.test(text)) attributes.severity = "moderate";
  else if (/中等|一般程度/u.test(text)) attributes.severity = "mild";

  if (["flaking", "blemishes", "small_bumps", "blackheads", "visible_pores"].includes(kind)) {
    if (/(?:一个|1个|一颗|1颗)/u.test(text)) attributes.amount = "isolated";
    else if (/几个|几颗|少量/u.test(text)) attributes.amount = "few";
    else if (/好几个|一些|若干/u.test(text)) attributes.amount = "several";
    else if (/很多|大量/u.test(text)) attributes.amount = "many";
    if (/零散|分散/u.test(text)) attributes.distribution = "scattered";
    else if (/一小片|一片|集中/u.test(text)) attributes.distribution = "clustered";
    else if (/大面积|到处|全脸/u.test(text)) attributes.distribution = "widespread";
    else if (areas.length === 1) attributes.distribution = "localized";
  }

  if (/比平时少|比往常少|没平时明显/u.test(text)) attributes.baseline_comparison = "less_than_usual";
  else if (/和平时差不多|跟平时差不多|和平时一样|跟往常一样/u.test(text)) attributes.baseline_comparison = "usual";
  else if (/比平时更|比往常更|比平时明显|比往常明显/u.test(text)) attributes.baseline_comparison = "more_than_usual";
  else if (/今天新出现|以前没有|第一次/u.test(text)) attributes.baseline_comparison = "new";
  return attributes;
}
