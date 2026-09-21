import { after, NextResponse } from "next/server";

import { usageFeedbackConversationApiResultSchema, usageFeedbackConversationRequestSchema } from "@/schemas/usage-feedback-conversation";
import { buildRecordedFeedbackSummary } from "@/features/usage-feedback-conversation/recorded-summary";
import { getUsageRequestContext } from "@/server/usage/get-usage-request-context";
import { createConfiguredVolcengineUsageFeedbackConversationProvider } from "@/server/usage-feedback-conversation/volcengine-usage-feedback-conversation-provider";
import { createUsageFeedbackConversationService, mapUsageFeedbackMessage } from "@/server/services/usage-feedback-conversation-service";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const contextStartedAt = performance.now();
  const context = await getUsageRequestContext();
  const contextDurationMs = elapsed(contextStartedAt);
  if (!context) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  const parsed = usageFeedbackConversationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR" } }, { status: 400 });
  const body = parsed.data;
  const routineStartedAt = performance.now();
  const routine = await context.routines.findById(context.user.id, body.routine_id);
  const routineDurationMs = elapsed(routineStartedAt);
  if (!routine) return NextResponse.json({ error: { code: "ROUTINE_NOT_FOUND" } }, { status: 404 });
  const provider = createConfiguredVolcengineUsageFeedbackConversationProvider();
  if (!provider) return NextResponse.json({ error: { code: "USAGE_FEEDBACK_PROVIDER_UNAVAILABLE" } }, { status: 503 });

  try {
    const memoryStartedAt = performance.now();
    const personalMemoryContext = await context.memory.retrieveUsageFeedback();
    const memoryDurationMs = elapsed(memoryStartedAt);
    if (process.env.NODE_ENV === "development") {
      console.info("[openviking-memory]", {
        stage: "memory_injection_usage_feedback",
        memory_count: personalMemoryContext.length,
        abstract_lengths: personalMemoryContext.map((abstract) => abstract.length),
        memory_injected: personalMemoryContext.length > 0,
      });
    }
    const providerStartedAt = performance.now();
    const result = await createUsageFeedbackConversationService(provider).converse(body, {
      routine: {
        period: routine.period as "am" | "pm",
        steps: routine.steps.map((step) => ({
          ownedProductId: step.owned_product_id,
          productName: [step.owned_product.product.brand_name, step.owned_product.product.product_name].filter(Boolean).join(" · "),
          stepOrder: step.step_order,
        })),
      },
      personalMemoryContext,
    });
    const providerDurationMs = elapsed(providerStartedAt);
    if (!result.draft) {
      logTiming({ total_ms: elapsed(startedAt), request_context_ms: contextDurationMs, routine_ms: routineDurationMs, memory_ms: memoryDurationMs, provider_and_mapping_ms: providerDurationMs, persistence_ms: 0 });
      return NextResponse.json({ data: usageFeedbackConversationApiResultSchema.parse({ reply: result.reply, saved: false, recorded_summary: null }) }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const persistenceStartedAt = performance.now();
    const persisted = await context.service.recordFeedbackMessage(
      context.user.id,
      body.routine_id,
      mapUsageFeedbackMessage(result.draft, { conversationId: body.conversation_id, messageId: body.message_id }, new Set(routine.steps.map((step) => step.owned_product_id))),
      routine,
    );
    const persistenceDurationMs = elapsed(persistenceStartedAt);
    if (persisted.applied) {
      const productNames = new Map(routine.steps.map((step) => [step.owned_product_id, [step.owned_product.product.brand_name, step.owned_product.product.product_name].filter(Boolean).join(" · ")]));
      after(async () => {
        const memoryCommitStartedAt = performance.now();
        try {
          await context.memory.commitFeedback({ history: persisted.history, productNames });
        } catch (error) {
          console.error("[openviking-memory]", {
            stage: "usage_feedback_background_failed",
            error_name: error instanceof Error ? error.name : typeof error,
          });
        } finally {
          if (process.env.NODE_ENV === "development") console.info("[openviking-memory]", { stage: "usage_feedback_background", duration_ms: elapsed(memoryCommitStartedAt) });
        }
      });
    }
    // `applied: false` means this message was already durably saved by an
    // earlier attempt. It is still a successful feedback result for the UI.
    const productNames = new Map(routine.steps.map((step) => [step.owned_product_id, [step.owned_product.product.brand_name, step.owned_product.product.product_name].filter(Boolean).join(" · ")]));
    logTiming({ total_ms: elapsed(startedAt), request_context_ms: contextDurationMs, routine_ms: routineDurationMs, memory_ms: memoryDurationMs, provider_and_mapping_ms: providerDurationMs, persistence_ms: persistenceDurationMs });
    return NextResponse.json({ data: usageFeedbackConversationApiResultSchema.parse({
      reply: result.reply,
      saved: true,
      recorded_summary: buildRecordedFeedbackSummary(persisted.history, productNames),
    }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[usage_feedback_auto_persist] failed", {
      error_name: error instanceof Error ? error.name : typeof error,
      error_code: error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause
        ? error.cause.code
        : undefined,
    });
    return NextResponse.json({ error: { code: "USAGE_FEEDBACK_AUTO_PERSIST_FAILED" } }, { status: 500 });
  }
}

function elapsed(startedAt: number) { return Math.round(performance.now() - startedAt); }
function logTiming(timings: Record<string, number>) { if (process.env.NODE_ENV === "development") console.info("[usage-feedback]", { stage: "timing", ...timings }); }
