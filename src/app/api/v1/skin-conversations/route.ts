import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserWithDiagnostic } from "@/server/auth/get-current-user";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createConfiguredSkinConversationProvider } from "@/server/skin-conversation/configured-skin-conversation-provider";
import { SkinConversationInternalError } from "@/server/skin-conversation/errors";
import { SkinConversationProviderError, SkinConversationProviderUnavailableError } from "@/server/skin-conversation/provider";
import { safeDailyState } from "@/server/services/skin-checkin-service";
import { createSkinConversationService } from "@/server/services/skin-conversation-service";
import { createConfiguredPersonalMemoryService } from "@/server/services/personal-memory-service";

const headers = { "Cache-Control": "private, no-store" };
type Stage = "auth" | "request_parsing" | "profile_loading" | "provider" | "response_serialization";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let stage: Stage = "auth";
  const timings: Record<string, number | string | null> = {};
  const authStartedAt = performance.now();
  const auth = await getCurrentUserWithDiagnostic();
  const authDurationMs = elapsed(authStartedAt);
  timings.auth = authDurationMs;
  if (!auth.user) {
    logDiagnostic(requestId, stage, "UNAUTHORIZED", auth.reason);
    return errorResponse(401, "UNAUTHORIZED", "请先登录。", requestId);
  }

  try {
    stage = "request_parsing";
    const requestParsingStartedAt = performance.now();
    const body = await request.json() as { recorded_date?: string; message?: string };
    timings.request_parsing = elapsed(requestParsingStartedAt);
    const serviceSetupStartedAt = performance.now();
    const provider = createConfiguredSkinConversationProvider();
    if (!provider) return errorResponse(503, "SKIN_CONVERSATION_UNAVAILABLE", "皮肤对话服务暂未配置，请使用手动记录。", requestId);
    timings.service_setup = elapsed(serviceSetupStartedAt);

    stage = "profile_loading";
    const supabase = await createClient();
    const existingStartedAt = performance.now();
    const existingPromise = measure(
      body.recorded_date
      ? createSkinCheckinRepository(supabase).findByDate(auth.user.id, body.recorded_date)
        : Promise.resolve(null),
      existingStartedAt,
    );
    const profileStartedAt = performance.now();
    const profilePromise = measure(createProfileRepository(supabase).findByUserId(auth.user.id), profileStartedAt);
    const memoryStartedAt = performance.now();
    const memory = createConfiguredPersonalMemoryService({ supabase, userId: auth.user.id });
    const personalMemoryPromise = measure(memory.retrieveDailySkin({
      message: typeof body.message === "string" ? body.message : "",
      activeTurnContext: Array.isArray((body as { active_turn_context?: unknown }).active_turn_context)
        ? (body as { active_turn_context: unknown[] }).active_turn_context.filter((entry): entry is string => typeof entry === "string")
        : [],
    }), memoryStartedAt);
    const [existingResult, profileResult, memoryResult] = await Promise.all([
      existingPromise,
      profilePromise,
      personalMemoryPromise,
    ]);
    const { value: existing, durationMs: existingDurationMs } = existingResult;
    const { value: profile, durationMs: profileDurationMs } = profileResult;
    const { value: personalMemoryContext, durationMs: memoryDurationMs } = memoryResult;
    timings.conversation_load = existingDurationMs;
    timings.profile_context = profileDurationMs;
    timings.daily_context = existingDurationMs;
    timings.recent_trends = "not_loaded_on_message";
    timings.personal_memory = memoryDurationMs;
    const existingCheckin = existing ? {
      dryness_level: existing.dryness_level, oiliness_level: existing.oiliness_level, redness_level: existing.redness_level,
      sensitivity_level: existing.sensitivity_level, acne_level: existing.acne_level, notes: existing.notes,
      daily_state: safeDailyState(existing.daily_state, existing.id), recorded_date: existing.recorded_date,
      known_fields: existing.known_fields ?? [], field_provenance: existing.field_provenance ?? {},
    } : null;

    stage = "provider";
    const conversationInput = {
      ...body,
      personalMemoryContext,
      existing_checkin: existingCheckin,
      profile_context: profile ? {
        skin_type: profile.skin_type as "dry" | "oily" | "combination" | "normal" | "unknown" | null,
        sensitivity_level: profile.sensitivity_level,
        skin_goals: profile.goals as ("hydration" | "barrier_support" | "oil_control" | "blemish_care" | "redness_relief" | "brightening" | "dark_spots" | "anti_aging")[],
        long_term_skin_baseline: profile.long_term_skin_baseline,
      } : null,
    };
    const providerStartedAt = performance.now();
    const mark = (name: string) => { timings[name] = elapsed(startedAt); };
    const encoder = new TextEncoder();
    let firstReplyDeltaForwarded = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            const result = await createSkinConversationService(provider).extract(conversationInput, {
              context_assembly: () => mark("context_assembly"),
              provider_request_started: () => mark("provider_request_started"),
              provider_first_event: () => mark("provider_first_event"),
              onReplyDelta: (delta) => {
                if (!delta) return;
                if (!firstReplyDeltaForwarded) {
                  firstReplyDeltaForwarded = true;
                  mark("server_first_reply_delta_forwarded");
                }
                controller.enqueue(encoder.encode(sse("reply_delta", { delta })));
              },
              provider_completed: () => mark("provider_completed"),
            });
            stage = "response_serialization";
            timings.provider_and_validation = elapsed(providerStartedAt);
            timings.final_validation_completed = elapsed(startedAt);
            timings.response_total = elapsed(startedAt);
            logTiming(requestId, timings);
            // This is the existing, server-validated client result, never raw
            // provider JSON or provider-specific events.
            controller.enqueue(encoder.encode(sse("final", { data: result })));
          } catch (error) {
            const code = streamErrorCode(error);
            logDiagnostic(requestId, stage, code, error instanceof Error ? error.message : "non_error_throw");
            timings.response_total = elapsed(startedAt);
            logTiming(requestId, timings);
            controller.enqueue(encoder.encode(sse("error", { error: { code, message: errorMessage(code), request_id: requestId } })));
          } finally {
            controller.close();
          }
        })();
      },
    });
    return new Response(stream, { headers: streamHeaders(requestId) });
  } catch (error) {
    const code = errorCode(error, stage);
    logDiagnostic(requestId, stage, code, error instanceof Error ? error.message : "non_error_throw");
    if (error instanceof ZodError && stage === "request_parsing") return errorResponse(400, "AMBIGUOUS_INPUT", "对话内容还不够明确。", requestId, error.flatten().fieldErrors);
    if (error instanceof SkinConversationProviderUnavailableError || error instanceof SkinConversationProviderError) return errorResponse(503, "SKIN_CONVERSATION_PROVIDER_FAILURE", "皮肤对话服务暂时不可用。", requestId);
    return errorResponse(500, "SKIN_CONVERSATION_INTERNAL_ERROR", "整理皮肤记录时出现了问题。", requestId);
  }
}

function responseHeaders(requestId: string) { return { ...headers, "X-Skin-Conversation-Request-Id": requestId }; }
function streamHeaders(requestId: string) { return { ...responseHeaders(requestId), "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" }; }
function errorResponse(status: number, code: string, message: string, requestId: string, fields?: unknown) { return NextResponse.json({ error: { code, message, request_id: requestId, ...(fields ? { fields } : {}) } }, { status, headers: responseHeaders(requestId) }); }
function errorCode(error: unknown, stage: Stage): string { if (error instanceof SkinConversationProviderError) return error.code; if (error instanceof SkinConversationProviderUnavailableError) return "SKIN_CONVERSATION_UNAVAILABLE"; if (error instanceof ZodError) return stage === "request_parsing" ? "AMBIGUOUS_INPUT" : "PROVIDER_OR_SERVICE_VALIDATION"; if (error instanceof SkinConversationInternalError) return error.code; return "UNEXPECTED_ERROR"; }
function streamErrorCode(error: unknown) { return error instanceof SkinConversationProviderError || error instanceof SkinConversationProviderUnavailableError ? "SKIN_CONVERSATION_PROVIDER_FAILURE" : "SKIN_CONVERSATION_INTERNAL_ERROR"; }
function errorMessage(code: string) { return code === "SKIN_CONVERSATION_PROVIDER_FAILURE" ? "皮肤对话服务暂时不可用。" : "整理皮肤记录时出现了问题。"; }
function sse(event: "reply_delta" | "final" | "error", payload: unknown) { return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`; }
function logDiagnostic(requestId: string, stage: Stage, code: string, detail: string) {
  console.error("[skin-conversation]", {
    requestId,
    stage,
    code,
    ...(process.env.NODE_ENV === "development" ? { detail } : {}),
  });
}
function elapsed(startedAt: number) { return Math.round(performance.now() - startedAt); }
async function measure<T>(promise: Promise<T>, startedAt: number) { return { value: await promise, durationMs: elapsed(startedAt) }; }
function logTiming(requestId: string, timings: Record<string, number | string | null>) { if (process.env.NODE_ENV === "development") console.info("[skin-conversation]", { requestId, stage: "timing", transport: "sse", ...timings }); }
