import Link from "next/link";
import { redirect } from "next/navigation";

import { UsageFeedbackConversation } from "@/features/usage-feedback-conversation/usage-feedback-conversation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getProfileContext } from "@/server/app-shell/app-shell-context";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { toRoutine } from "@/server/services/rule-engine-service";

export default async function UsageFeedbackPage({ searchParams }: { searchParams: Promise<{ routineId?: string; period?: string }> }) {
  const user = await getCurrentUser(); if (!user) redirect("/login");
  const supabase = await createClient(); const routines = createRoutineRepository(supabase); const query = await searchParams; const requested = query.routineId;
  const { profile } = await getProfileContext(user.id); const today = dateInTimeZone(new Date(), profile?.timezone ?? "Asia/Shanghai"); const period = query.period === "am" || query.period === "pm" ? query.period : currentPeriod(new Date(), profile?.timezone ?? "Asia/Shanghai");
  const routine = requested ? await routines.findById(user.id, requested) : await routines.findByDate(user.id, today, period);
  if (!routine) return <main className="mx-auto max-w-3xl px-6 py-12"><section className="rounded-3xl border bg-card p-6 shadow-sm"><p className="text-sm font-medium text-muted-foreground">使用反馈</p><h1 className="mt-2 text-2xl font-semibold">还没有可回顾的今日方案</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">先看看今天的护理安排，实际使用后再回来聊聊感受。</p><Link className="mt-5 inline-flex text-sm font-medium underline" href={`/today/${period}`}>查看今天的护理方案</Link></section></main>;
  return <UsageFeedbackConversation routine={toRoutine(routine)} />;
}

function dateInTimeZone(date: Date, timeZone: string) { const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const value = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${value.year}-${value.month}-${value.day}`; }
function currentPeriod(date: Date, timeZone: string): "am" | "pm" { return Number(new Intl.DateTimeFormat("en", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date)) >= 18 ? "pm" : "am"; }
