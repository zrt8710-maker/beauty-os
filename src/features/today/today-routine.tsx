"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { BrandLoading } from "@/components/brand-loading";
import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { readRoutineApiResponse, type RoutineGenerationResult } from "@/features/today/today-routine-generate-response";
import { buildTodayRoutineViewModel, userFacingExcludedProducts, type TodayExplanationStep, type TodayPurposeOmission, type TodayUnresolvedNeed } from "@/features/today/today-routine-view-model";
import { type Routine, type RoutinePeriod } from "@/schemas/routine";

type Context = { skinStatus: string; environment: string };
export function TodayRoutine({ initialRoutine = null, initialRoutines = [], initialFeedbackRoutineIds = [], activePeriod, context }: { initialRoutine?: Routine | null; initialRoutines?: Routine[]; initialFeedbackRoutineIds?: string[]; activePeriod?: RoutinePeriod; context: Context }) {
  const availableRoutines = initialRoutine
    ? [...initialRoutines.filter((routine) => routine.period !== initialRoutine.period), initialRoutine]
    : initialRoutines;
  const [routines, setRoutines] = useState<Partial<Record<RoutinePeriod, Routine>>>(() =>
    Object.fromEntries(availableRoutines.map((routine) => [routine.period, routine])),
  );
  const period = activePeriod ?? initialRoutine?.period ?? initialRoutines[0]?.period ?? "am";
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealVersion, setRevealVersion] = useState(0);
  const activeRoutine = routines[period] ?? null;
  const feedbackRoutineIds = new Set(initialFeedbackRoutineIds);
  const model = buildTodayRoutineViewModel(activeRoutine);

  async function generate(forceRegenerate = false) {
    const requestedPeriod = period;
    const requestBody = todayGenerateRequestBody(requestedPeriod, forceRegenerate);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/routines/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
      const generated = await readRoutineApiResponse(response);
      if (generated.kind === "success") {
        applyGeneratedRoutine(generated.routine, generated.generationResult, generated.generationExplanation);
        return;
      }
      if (generated.kind === "http_error") {
        setMessage(response.status === 409
          ? "本次重新生成未完成，请稍后重试。"
          : "这次生成没有成功，请再试一次。");
        return;
      }

      // A 2xx response means persistence succeeded. If its body cannot be
      // consumed by this client, read the saved routine instead of falsely
      // telling the user that generation failed.
      const readBack = await readBackTodayRoutine(requestedPeriod);
      const saved = readBack.routine;
      if (saved) {
        applyGeneratedRoutine(saved, "generated");
        setMessage("今日方案已生成，已重新读取保存的方案。");
        return;
      }
      setMessage("方案已保存，但返回内容暂时无法读取。刷新页面后可查看方案。");
    } catch {
      setMessage("客户端暂时无法显示已保存方案。请刷新页面后查看。");
    } finally { setBusy(false); }

    function applyGeneratedRoutine(nextRoutine: Routine, generationResult: RoutineGenerationResult, generationExplanation?: string) {
      if (generationResult === "generated" || generationResult === "deterministic_fallback") setRevealVersion((value) => value + 1);
      setRoutines((current) => ({ ...current, [nextRoutine.period]: nextRoutine }));
      setMessage(generationExplanation ?? generationResultMessage(generationResult, nextRoutine));
    }
  }

  return <div className="beauty-routine-reading space-y-7">
    <PeriodLinks activePeriod={period} routines={routines} />
    {busy ? <BrandLoading label="正在整理今天的护理方案…" /> : null}
    {!activeRoutine ? <NoRoutineState busy={busy} context={context} hasSavedRoutine={Object.keys(routines).length > 0} onGenerate={() => generate(false)} period={period} message={message} /> : <div key={revealVersion} className={`space-y-7 ${revealVersion ? "beauty-routine-reveal" : ""}`}>
      <CareConclusion model={model} />
      {model?.restrictions.length ? <Restrictions restrictions={model.restrictions} /> : null}
      <RoutineSteps busy={busy} onGenerate={() => generate(false)} onForceGenerate={() => generate(true)} period={period} steps={model?.steps ?? []} />
      <TodayNotUsing excludedProducts={userFacingExcludedProducts(activeRoutine)} />
      <UnmetNeeds needs={model?.unresolvedNeeds ?? []} />
      <FeedbackEntry recorded={feedbackRoutineIds.has(activeRoutine.id)} routine={activeRoutine} />
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>}
  </div>;
}

function PeriodLinks({ activePeriod, routines }: { activePeriod: RoutinePeriod; routines: Partial<Record<RoutinePeriod, Routine>> }) {
  const indicator = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = indicator.current;
    element?.getAnimations().forEach((animation) => animation.cancel());
    return () => element?.getAnimations().forEach((animation) => animation.cancel());
  }, [activePeriod]);
  function moveIndicator(next: RoutinePeriod) {
    const element = indicator.current;
    if (!element) return;
    const computed = getComputedStyle(element);
    const from = computed.transform;
    const color = computed.getPropertyValue(next === "pm" ? "--pm" : "--am").trim();
    element.getAnimations().forEach((animation) => animation.cancel());
    if (next === activePeriod || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([{ transform: from }, { transform: next === "pm" ? "translateX(calc(100% + 4px))" : "translateX(0)", backgroundColor: color }], { duration: 220, easing: "cubic-bezier(0.77, 0, 0.175, 1)", fill: "forwards" });
  }
  return <nav aria-label="今日方案时段" data-period={activePeriod} className="beauty-period-switch beauty-tabs flex w-full max-w-md">
    <span ref={indicator} className="beauty-period-indicator" aria-hidden="true" />
    {(["am", "pm"] as const).map((item) => <Button aria-label={`${item === "am" ? "AM 早间" : "PM 晚间"}${routines[item] ? " · 已生成" : " · 未生成"}`} aria-current={activePeriod === item ? "page" : undefined} className={`beauty-tab min-w-0 flex-1 gap-1 px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm ${activePeriod === item ? item === "am" ? "border-transparent bg-am text-am-foreground shadow-none hover:bg-am" : "border-transparent bg-pm text-pm-foreground shadow-none hover:bg-pm" : ""}`} key={item} nativeButton={false} render={<Link href={`/today/${item}`} onNavigate={() => moveIndicator(item)} />} variant={activePeriod === item ? "default" : "ghost"}><BeautyNavIcon active={activePeriod === item} name={item} size={16} />{item === "am" ? "AM 早间" : "PM 晚间"}<span className="sr-only sm:not-sr-only">{routines[item] ? " · 已生成" : " · 未生成"}</span></Button>)}
  </nav>;
}

export function generationResultMessage(generationResult: RoutineGenerationResult, routine: Routine) {
  if (generationResult === "reused") return "当前方案仍适合今天，已继续沿用。";
  if (generationResult === "retained_after_failure" || generationResult === "retained_previous") {
    return "本次更新未完成，已保留之前可安全使用的方案。";
  }
  if (generationResult === "deterministic_fallback") {
    return "当前展示根据已有信息整理的基础护理安排。";
  }
  return routine.steps.length ? "今日方案已生成。" : "库存中暂无可用于方案的产品。";
}

function NoRoutineState({ busy, context, hasSavedRoutine, message, onGenerate, period }: { busy: boolean; context: Context; hasSavedRoutine: boolean; message: string; onGenerate: () => void; period: RoutinePeriod }) {
  return <section aria-busy={busy} className="beauty-routine-welcome" data-period={period}><div className="mb-6 flex size-12 items-center justify-center rounded-full border border-border bg-card/70"><BeautyNavIcon name={period} size={24} /></div><p className={`text-sm font-semibold ${period === "am" ? "text-am-foreground" : "text-pm-foreground"}`}>{period === "am" ? "早间护理" : "晚间护理"}</p><h2 className="mt-2 text-2xl font-semibold">{period === "am" ? "早间方案尚未生成。" : "晚间方案尚未生成。"}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{hasSavedRoutine ? "另一时段的已保存方案仍然保留，可随时切换查看。" : `${context.skinStatus} ${context.environment}`}</p><div className="mt-6"><Button disabled={busy} onClick={onGenerate} type="button">{busy ? "处理中…" : `生成${period === "am" ? "早间" : "晚间"}方案`}</Button></div>{message ? <p aria-live="polite" className="mt-4 text-sm text-muted-foreground">{message}</p> : null}</section>;
}

function CareConclusion({ model }: { model: ReturnType<typeof buildTodayRoutineViewModel> }) {
  if (!model) return null;
  const skinContext = [...model.todayContext, ...model.baselineContext].join(" ") || "本次方案以你已保存的日常状态为参考，保持简单安排。";
  return (
    <section className="beauty-care-brief" aria-labelledby="care-brief-heading">
      <div className="beauty-care-overview">
        <h2 id="care-brief-heading">今天的护理安排</h2>
        <p className="beauty-care-summary">{model.headline}</p>
        {model.generationSource !== "deterministic_fallback" && model.purposeOmissions.length ? <PurposeOmissions omissions={model.purposeOmissions} /> : null}
      </div>
      {model.generationSource !== "deterministic_fallback" ? <dl className="beauty-care-context">
        <div><dt><BeautyNavIcon name="daily-skin" size={16} />皮肤依据</dt><dd>{skinContext}</dd></div>
        {model.weatherContext ? <div><dt><BeautyNavIcon name="today" size={16} />环境依据</dt><dd>{model.weatherContext}</dd></div> : null}
      </dl> : null}
    </section>
  );
}

function PurposeOmissions({ omissions }: { omissions: TodayPurposeOmission[] }) {
  return <details className="beauty-care-omissions beauty-disclosure-reading">
    <summary>今天未加入的护理 <span aria-hidden="true">＋</span></summary>
    <dl>{omissions.map((omission, index) => <div key={`${omission.purposeLabel}-${index}`}><dt>{omission.purposeLabel}</dt><dd>{omission.message}</dd></div>)}</dl>
  </details>;
}

function Restrictions({ restrictions }: { restrictions: string[] }) { return <section className="beauty-routine-section"><p className="text-sm font-semibold text-warning">今天先少做什么</p><ul className="mt-3 max-w-[68ch] space-y-2 text-sm leading-6 text-muted-foreground">{restrictions.map((restriction) => <li className="flex gap-3" key={restriction}><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-lavender" />{restriction}</li>)}</ul></section>; }

function RoutineSteps({ busy, onGenerate, onForceGenerate, period, steps }: { busy: boolean; onGenerate: () => void; onForceGenerate: () => void; period: RoutinePeriod; steps: TodayExplanationStep[] }) {
  return (
    <section className="py-1" aria-busy={busy}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className={`beauty-meta ${period === "am" ? "text-am-foreground" : "text-pm-foreground"}`}>护理顺序</p><h2 className="beauty-section-title mt-1">{period === "am" ? "早间方案" : "晚间方案"}</h2></div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={onGenerate} type="button" variant="outline">{busy ? "处理中…" : "检查并更新"}</Button>
          <Button disabled={busy} onClick={onForceGenerate} type="button" variant="ghost">完整重新生成</Button>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">检查并更新：先核对今天的状态，仍适合就沿用现有方案。完整重新生成：跳过沿用，重新生成一版，通常更慢；结果不一定不同。</p>
      {steps.length ? <ol className="beauty-routine-trail mt-6">{steps.map((step) => (
        <li className="beauty-routine-step grid grid-cols-[32px_minmax(0,1fr)] gap-3 sm:gap-5" key={step.id}>
          <span className="flex size-8 items-center justify-center rounded-full border border-selected-border bg-selected text-sm font-semibold text-selected-foreground">{step.order}</span>
          <div className="min-w-0">
            <p className="beauty-meta text-brand-deep">{step.purposeLabel}</p>
            <p className="mt-1 text-lg leading-snug font-semibold text-pretty">{step.productName}</p>
            {step.usage ? <section className="mt-3"><h3 className="text-sm font-medium">怎么用</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.usage}</p></section> : null}
            {step.whyToday || step.reason || step.comparisonNote ? <details className="beauty-routine-reasons beauty-disclosure-reading mt-2">
              <summary>查看这一步的护理依据 <span aria-hidden="true">＋</span></summary>
              <div className="flex max-w-[78ch] flex-col gap-4 border-t border-border/70 pt-3">
                {step.whyToday ? <section><h3 className="text-sm font-medium">为什么今天需要</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.whyToday}</p></section> : null}
                {step.reason ? <section><h3 className="text-sm font-medium">为什么选这瓶</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.reason}</p></section> : null}
                {step.comparisonNote ? <section><h3 className="text-sm font-medium">为什么更偏向它</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.comparisonNote}</p></section> : null}
              </div>
            </details> : null}
          </div>
        </li>
      ))}</ol> : <Empty text="这次没有形成可执行步骤。请查看下方仍未覆盖的部分。" />}
    </section>
  );
}

/** Keeps ordinary generation on the stable route; only an explicit UI action bypasses reuse. */
export function todayGenerateRequestBody(period: RoutinePeriod, forceRegenerate: boolean) {
  return forceRegenerate ? { period, forceRegenerate: true } : { period };
}

function TodayNotUsing({ excludedProducts }: { excludedProducts: ReturnType<typeof userFacingExcludedProducts> }) { if (!excludedProducts.length) return null; return <section className="beauty-routine-section"><p className="beauty-meta">今天先不用</p><ul className="mt-2 max-w-3xl divide-y divide-border/70">{excludedProducts.map((excluded) => <li className="py-3 text-sm leading-6" key={excluded.owned_product_id}><span className="font-medium">{excluded.product_name}</span><p className="mt-1 text-muted-foreground">{excluded.reason}</p></li>)}</ul></section>; }

function UnmetNeeds({ needs }: { needs: TodayUnresolvedNeed[] }) { if (!needs.length) return null; return <section className="beauty-routine-section"><h2 className="text-lg font-semibold">现有产品暂时没覆盖的部分</h2><ul className="mt-4">{needs.map((need) => <li className="beauty-list-row text-sm leading-6" key={need.concern}><p className="font-medium">{need.whatIsMissing}</p><p className="mt-1 text-muted-foreground">{need.whyItMatters}</p>{need.urgency === "needed_today" ? <p className="mt-2 text-foreground">如果今天会外出，这部分目前没有现有产品可以替代。</p> : need.urgency === "helpful_if_needed" ? <p className="mt-2 text-foreground">今天先保持精简即可，不需要为了补齐步骤临时增加产品。</p> : <p className="mt-2 text-foreground">不必急着在今天加步骤，可以长期慢慢处理。</p>}</li>)}</ul></section>; }

function FeedbackEntry({ recorded, routine }: { recorded: boolean; routine: Routine }) { return <section className="beauty-routine-section"><p className="beauty-meta">使用反馈 · {recorded ? "已记录" : "尚未记录"}</p><p className="mt-2 text-sm text-muted-foreground">聊聊今天实际用了哪些产品、感觉怎么样。</p><Button className="mt-4" nativeButton={false} render={<Link href={`/usage-feedback?routineId=${encodeURIComponent(routine.id)}&period=${routine.period}`} />}><BeautyNavIcon name="usage-feedback" size={16} />记录使用反馈</Button></section>; }

function Empty({ text }: { text: string }) { return <div className="beauty-empty mt-6">{text}</div>; }
async function readBackTodayRoutine(period: RoutinePeriod): Promise<{ routine: Routine | null }> {
  try {
    const response = await fetch(`/api/v1/routines/today?period=${period}`);
    const result = await readRoutineApiResponse(response);
    return {
      routine: result.kind === "success" ? result.routine : null,
    };
  } catch {
    return { routine: null };
  }
}

