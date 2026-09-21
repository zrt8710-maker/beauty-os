import "server-only";

import { dailyStateSchema, type DailyState, type DailyStateArea, type DailyStateConcernKind, type SkinCheckinField } from "@/schemas/checkin";
import { parseConversationFirstModelOutput, skinConversationRequestSchema, skinConversationResultSchema, type SkinConversationModelOutput, type SkinConversationRequest, type SkinConversationResult } from "@/schemas/skin-conversation";
import type { SkinConversationProvider, SkinConversationProviderCallbacks } from "@/server/skin-conversation/provider";
import { canonicalPatchFromDailyState, hasUnresolvedSubstantiveConversationInput, mergeProviderAndTranscriptFacts, validateNormalDayEvidence } from "@/server/skin-conversation/durable-conversation-facts";
import { SkinConversationInternalError } from "@/server/skin-conversation/errors";

const fields: SkinCheckinField[] = ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"];
const emptyObservations = { locations: [], tightness: null, flaking: null, roughness: null, visible_shine: null, blemish_count: null, blemish_distribution: null, pain_tenderness: null, small_bumps: null, blackheads: null, itching: null, burning: null, triggers: [], duration: null, baseline_comparison: null };

/** Conversation comes first. Canonical facts are only merged once the user has naturally finished. */
export function createSkinConversationService(provider: SkinConversationProvider) {
  return { async extract(input: unknown, callbacks?: SkinConversationProviderCallbacks): Promise<SkinConversationResult> {
    const request = skinConversationRequestSchema.parse(input);
    const modelOutput = enforceUserFacingBoundary(normalizeModelOutput(parseConversationFirstModelOutput(await provider.extract(request, callbacks))), request);
    const naturalCompletion = isCompletionConfirmation(request.message, request.active_turn_context);
    const providerCompletionSignal = modelOutput.conversational_intent === "complete" || modelOutput.readiness === "confirm" || modelOutput.readiness === "ready";
    // The model may decide that the conversation is sufficiently clear.  The
    // priority object is advisory context only; it must not turn Profile
    // topics or unfilled conversational dimensions into a forced checklist.
    // Finalization still requires the user's explicit UI action below.
    const completion_available = !request.finalize_requested && (naturalCompletion || providerCompletionSignal);
    const readiness = request.finalize_requested ? "ready" : completion_available ? "confirm" : "continue";
    const existing = request.existing_checkin;
    const normalDayValidation = validateNormalDayEvidence(modelOutput.normal_day_evidence, request.active_turn_context);
    const providerHasPresentConcern = modelOutput.daily_state?.version === 2
      && modelOutput.daily_state.concerns.some((concern) => concern.status === "present");
    const validNormalDayEvidence = normalDayValidation.grounded
      && !normalDayValidation.contradicted
      && !providerHasPresentConcern;
    const finalizedFacts = readiness === "ready"
      ? mergeProviderAndTranscriptFacts(modelOutput.daily_state ?? null, request.active_turn_context, validNormalDayEvidence)
      : null;
    const daily_state = readiness === "ready" ? withFinalizeProvenance(
      mergeDailyState(existing?.daily_state ?? null, dailyStateSchema.parse(finalizedFacts ?? fallbackDailyState(validNormalDayEvidence))),
      request.active_turn_context,
    ) : null;
    const unresolvedSubstantiveInput = hasUnresolvedSubstantiveConversationInput(
      request.active_turn_context,
      validNormalDayEvidence ? normalDayValidation.groundedStatements : undefined,
    );
    logFinalizeDiagnostics(request, modelOutput, daily_state, unresolvedSubstantiveInput, normalDayValidation.grounded, validNormalDayEvidence);
    if (
      readiness === "ready"
      && daily_state?.version === 2
      && daily_state.concerns.length === 0
      && (!validNormalDayEvidence || unresolvedSubstantiveInput)
    ) {
      throw new SkinConversationInternalError(
        "Finalize produced no durable facts for a substantive conversation.",
        "durable_fact_validation",
      );
    }
    const patch = readiness === "continue" ? {} : {
      ...(readiness === "ready" ? canonicalPatchFromDailyState(daily_state) : {}),
      ...patchFromAssessments(modelOutput),
    };
    const mergedValues = existing ?? emptyCheckin(request.recorded_date);
    const known = new Set(existing?.known_fields ?? []);
    const provenance = { ...(existing?.field_provenance ?? {}) };
    const changed_fields = fields.filter((field) => field in patch);
    for (const field of changed_fields) { mergedValues[field] = patch[field]!; known.add(field); provenance[field] = [...new Set([...(provenance[field] ?? []), "conversation" as const])]; }
    const clarification = readiness === "ready" ? undefined : modelOutput.suggested_followup ?? modelOutput.clarification ?? (completion_available ? "如果没有其他补充，可以结束这轮，我来整理今天的状态。" : undefined);
    return skinConversationResultSchema.parse({ reply: modelOutput.reply, patch: { ...patch, notes: request.message }, unknown_fields: fields.filter((field) => !known.has(field)), readiness, completion_available, ...(clarification ? { clarification } : {}), confidence: modelOutput.confidence ?? 50, observations: modelOutput.observations ?? emptyObservations, daily_state, proposed_checkin: { ...mergedValues, notes: request.message, daily_state, known_fields: fields.filter((field) => known.has(field)), field_provenance: provenance }, changed_fields });
  } };
}

function normalizeModelOutput(output: SkinConversationModelOutput): SkinConversationModelOutput {
  return { ...output, assessments: output.assessments ?? [], observations: output.observations ?? emptyObservations, daily_state: output.daily_state ?? null, confidence: output.confidence ?? 50 };
}

const internalPlanningPattern = /了解今日.+情况|用户新提出.+需要进一步了解|确认用户是否|收尾时轻问|conversation[_ ]?priority|suggested[_ ]?followup|clarification|下一步需要|需要进一步了解/u;
const uncertaintyPattern = /不知道|不确定|不太会判断|算不算(?:明显|严重|油|干)|好像.{0,12}(?:不知道|不确定)/u;

/** Provider output is untrusted: internal planning and uncertainty-to-fact conversions never cross the chat boundary. */
export function enforceUserFacingBoundary(output: SkinConversationModelOutput, request: { message: string; active_turn_context?: string[]; profile_context?: SkinConversationRequest["profile_context"] }): SkinConversationModelOutput {
  const uncertainty = uncertaintyPattern.test(request.message);
  const concern = relevantConcern([...(request.active_turn_context ?? []), request.message].join(" "));
  // Uncertainty constrains only durable facts. A natural, non-technical model
  // reply should remain visible instead of being replaced by a scripted line.
  const reply = internalPlanningPattern.test(output.reply) ? safeReply(concern) : output.reply;
  if (!uncertainty) return { ...output, reply };
  const uncertainField = concern === "oiliness" ? "oiliness_level" : concern === "dryness" ? "dryness_level" : concern === "redness" ? "redness_level" : concern === "discomfort" ? "sensitivity_level" : concern === "blemishes" ? "acne_level" : null;
  return { ...output, reply, assessments: output.assessments.map((assessment) => assessment.field === uncertainField ? { ...assessment, status: "unknown", level: null, evidence: "用户明确表示不确定，不能推定程度或与平时的比较。" } : assessment), daily_state: null };
}

function relevantConcern(text: string) { if (/出油|油光|油感|油腻|有点油|油/u.test(text)) return "oiliness"; if (/干燥|干紧|紧绷|粗糙|起皮|脱皮/u.test(text)) return "dryness"; if (/泛红|发红/u.test(text)) return "redness"; if (/刺|痒|灼热|不舒服/u.test(text)) return "discomfort"; if (/闭口|小疙瘩|小凸起/u.test(text)) return "small_bumps"; if (/痘|粉刺/u.test(text)) return "blemishes"; return "other"; }
function safeReply(concern: string) { return concern === "oiliness" ? "不用先判断轻不轻。你可以看看现在是只有一点油光，还是摸起来已经有明显油感？" : "不用急着判断，我们可以先按你实际看到或感觉到的情况慢慢说。"; }

function fallbackDailyState(normalDay: boolean): DailyState { return { version: 2, summary: normalDay ? "今天没有补充特别的皮肤变化。" : "已按这次对话整理今天的皮肤感受。", concerns: [] }; }
type ConversationTurn = { role: "user" | "assistant"; content: string };
const concernPatterns: Record<DailyStateConcernKind, RegExp> = {
  oiliness: /出油|油光|油感|油腻|有点油|很油/u,
  dryness: /干燥|发干|有点干|很干|紧绷|粗糙/u,
  flaking: /起皮|脱皮/u,
  roughness: /粗糙|不平整/u,
  redness: /泛红|发红/u,
  stinging: /刺痛|刺/u,
  itching: /发痒|痒/u,
  burning: /灼热|灼痛/u,
  blemishes: /长痘|痘痘|粉刺/u,
  small_bumps: /闭口|小颗粒|小凸起|小疙瘩/u,
  blackheads: /黑头/u,
  visible_pores: /毛孔/u,
  uneven_tone: /肤色不均|色差/u,
  dullness: /暗沉|没精神/u,
  post_blemish_marks: /痘印|残留印记|色沉/u,
};
const areaPatterns: Record<DailyStateArea, RegExp> = {
  t_zone: /Ts*区/u, forehead: /额头/u, hairline: /发际线/u, nose: /鼻子/u,
  nose_wings: /鼻翼/u, cheeks: /脸颊|面颊/u, chin: /下巴/u, eye_area: /眼周/u,
  full_face: /全脸|整脸|整张脸|脸上都/u, other: /局部|其他地方/u,
};

/** Finalize-only provenance bridge. Provider output is ignored for these fields. */
function withFinalizeProvenance(state: DailyState | null, activeTurnContext: string[]): DailyState | null {
  if (!state || state.version !== 2) return state;
  const turns = activeTurnContext.flatMap(parseTurn);
  return {
    ...state,
    concerns: state.concerns.map((concern) => ({
      ...concern,
      interaction_origin: interactionOriginFor(concern.kind, turns),
      area_origin: areaOriginFor(concern.areas, concern.kind, turns),
    })),
  };
}

function parseTurn(entry: string): ConversationTurn[] {
  if (entry.startsWith("用户：")) return [{ role: "user", content: entry.slice(3) }];
  if (entry.startsWith("Beauty OS：")) return [{ role: "assistant", content: entry.slice(10) }];
  return [];
}

function interactionOriginFor(kind: DailyStateConcernKind, turns: ConversationTurn[]) {
  const firstUser = turns.findIndex((turn) => turn.role === "user" && concernPatterns[kind].test(turn.content));
  if (firstUser >= 0) {
    return turns.slice(0, firstUser).some((turn) => turn.role === "assistant" && concernPatterns[kind].test(turn.content))
      ? "assistant_prompted" as const
      : "user_raised" as const;
  }
  const promptIndex = turns.findIndex((turn) => turn.role === "assistant" && concernPatterns[kind].test(turn.content));
  return promptIndex >= 0 && turns.slice(promptIndex + 1).some((turn) => turn.role === "user")
    ? "assistant_prompted" as const
    : "unknown" as const;
}

function areaOriginFor(areas: DailyStateArea[], kind: DailyStateConcernKind, turns: ConversationTurn[]) {
  if (areas.length === 0) return "unknown" as const;
  const userTurns = turns.filter((turn) => turn.role === "user" && concernPatterns[kind].test(turn.content));
  return areas.every((area) => userTurns.some((turn) => areaPatterns[area].test(turn.content)))
    ? "user_confirmed" as const
    : "unknown" as const;
}
/** A short answer only closes the whole conversation after an open supplementation invitation. */
export function isCompletionConfirmation(message: string, activeTurnContext: string[] = []) {
  const text = message.trim();
  if (/^(没有了|没了|没别的|没有别的|差不多就这些|差不多这些|先这样|可以了|可以整理了|没有其他(?:了)?|没其他(?:了)?|没有更多(?:了)?)[。！!，,\s]*$/u.test(text)) return true;
  const lastAssistant = [...activeTurnContext].reverse().find((turn) => turn.startsWith("Beauty OS："))?.replace(/^Beauty OS：/, "") ?? "";
  const isSupplementationInvite = /还有.*(?:想记下|和平时不太一样)|没有的话我就按这些(?:帮你)?整理/u.test(lastAssistant);
  return isSupplementationInvite && /^(没有|没有了|没了|就这些|差不多了|可以了|可以整理了|(?:帮我)?整理(?:一下|吧)?|就按这些整理)[。！!，,\s]*$/u.test(text);
}
function logFinalizeDiagnostics(
  request: SkinConversationRequest,
  modelOutput: SkinConversationModelOutput,
  dailyState: DailyState | null,
  unresolvedSubstantiveInput: boolean,
  normalDayEvidenceGrounded: boolean,
  normalDayEvidenceValid: boolean,
) {
  if (process.env.NODE_ENV !== "development" || !request.finalize_requested) return;
  const providerState = modelOutput.daily_state?.version === 2 ? modelOutput.daily_state : null;
  console.info("[skin-conversation]", {
    stage: "finalize_durable_fact_diagnostics",
    provider_readiness: modelOutput.readiness ?? null,
    provider_conversational_intent: modelOutput.conversational_intent ?? null,
    provider_summary_present: Boolean(providerState?.summary),
    provider_concern_count: providerState?.concerns.length ?? 0,
    provider_concern_statuses: providerState?.concerns.map((concern) => ({ kind: concern.kind, status: concern.status })) ?? [],
    finalized_summary_present: dailyState?.version === 2 ? Boolean(dailyState.summary) : false,
    finalized_concern_count: dailyState?.version === 2 ? dailyState.concerns.length : 0,
    unresolved_substantive_input: unresolvedSubstantiveInput,
    normal_day_evidence_present: Boolean(modelOutput.normal_day_evidence),
    normal_day_evidence_grounded: normalDayEvidenceGrounded,
    normal_day_evidence_valid: normalDayEvidenceValid,
  });
}
function mergeDailyState(existing: DailyState | null, proposed: DailyState | null): DailyState | null { if (!proposed) return existing; if (!existing) return proposed; if (existing.version === 2 || proposed.version === 2) return mergeV2DailyState(toV2(existing), toV2(proposed)); const details = new Map(existing.details.map((detail) => [`${detail.area ?? ""}:${detail.finding}`, detail])); for (const detail of proposed.details) details.set(`${detail.area ?? ""}:${detail.finding}`, detail); return { version: 1, summary: proposed.summary ?? existing.summary, details: [...details.values()] }; }
function mergeV2DailyState(existing: Extract<DailyState, { version: 2 }>, proposed: Extract<DailyState, { version: 2 }>): Extract<DailyState, { version: 2 }> { const concerns = new Map(existing.concerns.map((concern) => [`${concern.kind}:${concern.areas.join(",")}`, concern])); for (const concern of proposed.concerns) concerns.set(`${concern.kind}:${concern.areas.join(",")}`, concern); return { version: 2, summary: proposed.summary ?? existing.summary, concerns: [...concerns.values()] }; }
function toV2(state: DailyState): Extract<DailyState, { version: 2 }> { if (state.version === 2) return state; return { version: 2, summary: state.summary, concerns: state.details.map((detail) => ({ kind: v1FindingToConcern(detail.finding), status: detail.status, areas: [v1AreaToV2(detail.area)], attributes: {}, user_wording: detail.description ? [detail.description] : [], source: detail.source })) }; }
function v1AreaToV2(area: string | null): DailyStateArea { const areas: Record<string, DailyStateArea> = { "T区": "t_zone", "额头": "forehead", "发际线": "hairline", "鼻子": "nose", "鼻翼": "nose_wings", "脸颊": "cheeks", "下巴": "chin", "眼周": "eye_area", "全脸": "full_face" }; return area ? areas[area] ?? "other" : "other"; }
function v1FindingToConcern(finding: string): DailyStateConcernKind { const kinds: Record<string, DailyStateConcernKind> = { oil_shine: "oiliness", dryness: "dryness", flaking: "flaking", roughness: "roughness", redness: "redness", small_bumps: "small_bumps", blemishes: "blemishes", blackheads: "blackheads", itching: "itching", burning: "burning", tightness: "dryness", tenderness: "blemishes", other: "uneven_tone" }; return kinds[finding] ?? "uneven_tone"; }
function emptyCheckin(recordedDate: string) { return { dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: null, recorded_date: recordedDate, known_fields: [] as SkinCheckinField[], field_provenance: {} }; }
function patchFromAssessments(output: SkinConversationModelOutput): Partial<Record<SkinCheckinField, number>> { return Object.fromEntries((output.assessments ?? []).flatMap((assessment) => assessment.status === "known" && assessment.level !== null ? [[assessment.field, assessment.level]] : [])); }
