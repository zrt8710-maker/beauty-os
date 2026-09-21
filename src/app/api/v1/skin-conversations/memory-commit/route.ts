import { after, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { createConfiguredPersonalMemoryService } from "@/server/services/personal-memory-service";

const requestSchema = z.object({
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }).strict()).min(1).max(30),
}).strict();

/** A best-effort archive of an already-persisted Daily Skin conversation. */
export async function POST(request: Request) {
  if (!await getCurrentUser()) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR" } }, { status: 400 });
  after(async () => {
    const startedAt = performance.now();
    try {
      await createConfiguredPersonalMemoryService().commitDailySkinTranscript(parsed.data.transcript);
    } catch (error) {
      console.error("[openviking-memory]", {
        stage: "daily_skin_transcript_background_failed",
        error_name: error instanceof Error ? error.name : typeof error,
      });
    } finally {
      if (process.env.NODE_ENV === "development") console.info("[openviking-memory]", { stage: "daily_skin_transcript_background", duration_ms: Math.round(performance.now() - startedAt) });
    }
  });
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
