"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { skinCheckinSchema, type SkinCheckin, type SkinCheckinInput } from "@/schemas/checkin";
import type { RecentSkinTrend } from "@/domain/recent-skin-trend";
import { buildDailyFallbackNarration } from "@/features/check-in/daily-skin-narration-fallback";
import { DailySkinNarrationSection } from "@/features/check-in/daily-skin-narration-section";
import type { Profile } from "@/schemas/profile";
import { DailySkinEditView } from "@/features/check-in/daily-skin-edit-view";
import { buildSkinHistoryCompression, type SkinHistoryCompression } from "@/features/check-in/skin-history-compression-model";

type CheckinDraft = SkinCheckinInput;

export function CheckinManager({ initialCheckins, today, selectedDate = today, recentTrends = [], profile = null, history, dailyNarrations = {} }: { initialCheckins: SkinCheckin[]; today: string; selectedDate?: string; recentTrends?: RecentSkinTrend[]; profile?: Pick<Profile, "long_term_skin_baseline" | "skin_type"> | null; history: SkinHistoryCompression; dailyNarrations?: Record<string, string> }) {
  const [checkins, setCheckins] = useState(initialCheckins);
  const [draft, setDraft] = useState<CheckinDraft>(() => toDraft(initialCheckins.find((item) => item.recorded_date === today), today));
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");
  const todayCheckin = checkins.find((checkin) => checkin.recorded_date === selectedDate);
  const effectiveHistory = profile ? mergeServerNarration(buildSkinHistoryCompression({ checkins, profile, recentTrends, today }), history) : history;

  function openEditor(checkin?: SkinCheckin) {
    setDraft(toDraft(checkin ?? todayCheckin, checkin?.recorded_date ?? today));
    setStatus("idle"); setMessage(""); setEditorOpen(true);
  }
  async function saveCheckin() {
    setStatus("saving"); setMessage("");
    try {
      const response = await fetch("/api/v1/skin-checkins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const saved = parseData(await response.json());
      if (!response.ok || !saved) throw new Error("SAVE_FAILED");
      setCheckins((current) => [saved, ...current.filter((item) => item.id !== saved.id)].sort((a, b) => b.recorded_date.localeCompare(a.recorded_date)));
      // Weekly narration runs in the server-rendered history path. Refresh only
      // after a successful write so a newly completed batch receives it.
      if (typeof window !== "undefined") window.setTimeout(() => window.location.reload(), 0);
      setEditorOpen(false); setStatus("idle"); setMessage(`${saved.recorded_date} 的皮肤状态已保存。`);
    } catch { setStatus("error"); setMessage("保存失败，请检查记录后重试。"); }
  }
  if (editorOpen) return <DailySkinEditView draft={draft} message={message} onCancel={() => setEditorOpen(false)} onChange={setDraft} onSave={saveCheckin} profile={profile} saving={status === "saving"} />;
  const narration = todayCheckin ? dailyNarrations[todayCheckin.recorded_date] ?? buildDailyFallbackNarration(todayCheckin) : null;
  return <div className="beauty-journal">{narration ? <DailySkinNarrationSection date={selectedDate} message={message} narration={narration} onAdjust={() => openEditor()} /> : <TodayStatusSection checkin={todayCheckin} message={message} onManual={() => openEditor()} today={selectedDate} />}<RecentStatusSection history={effectiveHistory} weeklyProgressDays={effectiveHistory.unsettledDaily.length} /></div>;
}


function TodayStatusSection({ checkin, message, onManual, today }: { checkin?: SkinCheckin; message: string; onManual: () => void; today: string }) {
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">今天 <span className="text-sm font-normal text-muted-foreground">· {today}</span></h2>
        <span className="text-xs text-muted-foreground">{checkin ? "已记录" : "尚未记录"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {!checkin ? <Button className="w-full sm:w-auto" nativeButton={false} render={<Link href="/app" />} size="sm">去首页记录</Button> : null}
        <Button className="w-full sm:w-auto" onClick={onManual} size="sm" type="button" variant="secondary">{checkin ? "调整今日状态" : "手动记录"}</Button>
      </div>
      </div>
      {!checkin ? <p className="beauty-helper mt-3">你可以从首页自然记录今天的感受，也可以在这里手动补充。</p> : null}
      {message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}


function RecentStatusSection({ history, weeklyProgressDays }: { history: SkinHistoryCompression; weeklyProgressDays: number }) {
  return (
    <div className="beauty-section-major">
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="beauty-section-title">最近七天</h2>
          {weeklyProgressDays ? <p className="beauty-meta">已记录 {weeklyProgressDays} / 7 天</p> : null}
        </div>
        {history.unsettledDaily.length ? (
          <ul className="mt-4 max-w-3xl divide-y divide-border/70 border-y border-border/70">
            {history.unsettledDaily.map((entry) => (
              <li className="grid gap-1 py-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-6" key={entry.date}>
                <p className="font-semibold tracking-[-0.01em]">{formatDailyDate(entry.date)}</p>
                <p className="text-sm leading-6 text-muted-foreground">{entry.summary}</p>
              </li>
            ))}
          </ul>
        ) : <p className="beauty-helper mt-4">还没有最近七天的记录。新的每日状态会按日期出现在这里。</p>}
      </section>
      <section className="mt-10">
        <h2 className="beauty-section-title">阶段总结</h2>
        <div className="mt-5 max-w-3xl divide-y divide-border/70 border-y border-border/70">
          <SummarySection emptyDescription="完成 7 天记录后，这里会生成本周皮肤总结。" summaries={history.weeklySummaries.map((summary) => ({ period: formatDateRange(summary.period.start, summary.period.end), overall: summary.overall }))} title="周总结" />
          <SummarySection emptyDescription="完成本月记录后，这里会生成月度皮肤总结。" summaries={history.monthlySummaries.map((summary) => ({ period: formatDateRange(summary.period.start, summary.period.end), overall: summary.overall }))} title="月总结" />
        </div>
      </section>
    </div>
  );
}
function SummaryRow({ period, overall }: { period: string; overall: string }) { return <article><p className="beauty-meta">{period}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{overall}</p></article>; }
function SummarySection({ title, emptyDescription, progress, summaries }: { title: string; emptyDescription: string; progress?: string; summaries: { period: string; overall: string }[] }) { return <section className="py-6"><h3 className="beauty-object-title">{title}</h3><div className="mt-3">{summaries.length ? <div className="space-y-4">{summaries.map((summary) => <SummaryRow key={summary.period} overall={summary.overall} period={summary.period} />)}</div> : <div className="space-y-1 text-sm leading-6 text-muted-foreground">{progress ? <p>{progress}</p> : null}<p>{emptyDescription}</p></div>}</div></section>; }
function mergeServerNarration(current: SkinHistoryCompression, serverHistory: SkinHistoryCompression) { const narrationByPeriod = new Map(serverHistory.weeklySummaries.map((summary) => [`${summary.period.start}:${summary.period.end}`, summary.overall])); const narrationByDate = new Map(serverHistory.unsettledDaily.map((entry) => [entry.date, entry.summary])); return { ...current, unsettledDaily: current.unsettledDaily.map((entry) => ({ ...entry, summary: narrationByDate.get(entry.date) ?? entry.summary })), weeklySummaries: current.weeklySummaries.map((summary) => ({ ...summary, overall: narrationByPeriod.get(`${summary.period.start}:${summary.period.end}`) ?? summary.overall })) }; }
function formatDailyDate(value: string) { const [, month, day] = value.split("-"); return month && day ? `${Number(month)} 月 ${Number(day)} 日` : value; }
function formatDateRange(start: string, end: string) { const format = (value: string) => { const [, month, day] = value.split("-"); return month && day ? `${Number(month)}/${Number(day)}` : value; }; return `${format(start)}–${format(end)}`; }
function toDraft(checkin: SkinCheckin | undefined, recorded_date: string): CheckinDraft { return checkin ? { dryness_level: checkin.dryness_level, oiliness_level: checkin.oiliness_level, redness_level: checkin.redness_level, sensitivity_level: checkin.sensitivity_level, acne_level: checkin.acne_level, notes: checkin.notes, daily_state: checkin.daily_state, recorded_date: checkin.recorded_date, known_fields: checkin.known_fields, field_provenance: checkin.field_provenance } : { dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: null, recorded_date, known_fields: [], field_provenance: {} }; }
function parseData(value: unknown): SkinCheckin | null { if (typeof value !== "object" || value === null || !("data" in value)) return null; const result = skinCheckinSchema.safeParse(value.data); return result.success ? result.data : null; }
