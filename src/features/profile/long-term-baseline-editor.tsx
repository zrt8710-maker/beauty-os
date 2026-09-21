"use client";

import { SkinGradingHelp } from "@/features/skin-grading/skin-grading-help";
import {
  frequencyOptions,
  recurringTendencyConfig,
  recurringTendencyGradingConcerns,
  usualIntensityLabel,
  usualIntensityOptions,
} from "@/features/profile/long-term-baseline-config";
import type { LongTermSkinBaseline } from "@/schemas/profile";

const areas = [["t_zone", "T区"], ["forehead", "额头"], ["nose", "鼻子"], ["nose_wings", "鼻翼"], ["cheeks", "脸颊"], ["chin", "下巴"], ["full_face", "全脸"]] as const;
const tendencies = Object.entries(recurringTendencyConfig) as Array<[LongTermSkinBaseline["recurring_tendencies"][number]["kind"], (typeof recurringTendencyConfig)[LongTermSkinBaseline["recurring_tendencies"][number]["kind"]]]>;
const tendencyLabels = Object.fromEntries(tendencies.map(([kind, config]) => [kind, config.label])) as Record<string, string>;
const areaLabels = Object.fromEntries(areas) as Record<string, string>;

export function LongTermBaselineEditor({ value, onChange }: { value: LongTermSkinBaseline; onChange: (value: LongTermSkinBaseline) => void }) {
  const toggleArea = (key: "usual_oily_areas" | "usual_dry_areas", area: LongTermSkinBaseline[typeof key][number]) => onChange({ ...value, [key]: value[key].includes(area) ? value[key].filter((item) => item !== area) : [...value[key], area] });
  const toggleTendency = (kind: LongTermSkinBaseline["recurring_tendencies"][number]["kind"]) => onChange({ ...value, recurring_tendencies: value.recurring_tendencies.some((item) => item.kind === kind) ? value.recurring_tendencies.filter((item) => item.kind !== kind) : [...value.recurring_tendencies, { kind, usual_areas: [], tendency: "unknown", frequency: "unknown", usual_intensity: "unknown", source: "user_declared" }] });
  const updateTendency = (kind: LongTermSkinBaseline["recurring_tendencies"][number]["kind"], update: Partial<LongTermSkinBaseline["recurring_tendencies"][number]>) => onChange({ ...value, recurring_tendencies: value.recurring_tendencies.map((item) => item.kind === kind ? { ...item, ...update } : item) });

  return (
    <div className="space-y-8">
      <section className="beauty-section">
        <p className="text-sm font-medium text-muted-foreground">平时容易出油 / 干的区域</p>
        <h2 className="mt-1 text-xl font-semibold">平时比较容易出油的是哪里？</h2>
        <p className="mt-2 text-sm text-muted-foreground">可多选；没特别留意可以不选。</p>
        <AreaChoices selected={value.usual_oily_areas} onToggle={(area) => toggleArea("usual_oily_areas", area)} />
        <h2 className="mt-8 text-xl font-semibold">平时比较容易干、紧或者起皮的是哪里？</h2>
        <p className="mt-2 text-sm text-muted-foreground">这也是平时状态，不是今天的判断。</p>
        <AreaChoices selected={value.usual_dry_areas} onToggle={(area) => toggleArea("usual_dry_areas", area)} />
      </section>
      <section className="beauty-section">
        <p className="text-sm font-medium text-muted-foreground">平时反复出现的情况</p>
        <h2 className="mt-1 text-xl font-semibold">这些情况你平时会不会反复遇到？</h2>
        <p className="mt-2 text-sm text-muted-foreground">按你自己的感受选择；不用先判断医学名称。</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {tendencies.map(([kind, config]) => <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border/80 bg-card px-3 py-2.5 text-sm" key={kind}><input checked={value.recurring_tendencies.some((item) => item.kind === kind)} onChange={() => toggleTendency(kind)} type="checkbox" />{config.label}</label>)}
        </div>
        {value.recurring_tendencies.map((item) => <details className="mt-4 border-t border-border/70 pt-4" key={item.kind}><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{tendencyLabels[item.kind]} · 补充平时情况（可选）</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">通常主要出现在哪里？<AreaChoices selected={item.usual_areas} onToggle={(area) => updateTendency(item.kind, { usual_areas: item.usual_areas.includes(area) ? item.usual_areas.filter((current) => current !== area) : [...item.usual_areas, area] })} /></label><label className="text-sm">多常出现？<select className="beauty-field mt-2" value={item.frequency ?? item.tendency} onChange={(event) => updateTendency(item.kind, { frequency: event.target.value as typeof frequencyOptions[number][0], tendency: event.target.value as LongTermSkinBaseline["recurring_tendencies"][number]["tendency"] })}>{frequencyOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm">平时通常有多明显？<select className="beauty-field mt-2" value={item.usual_intensity} onChange={(event) => updateTendency(item.kind, { usual_intensity: event.target.value as LongTermSkinBaseline["recurring_tendencies"][number]["usual_intensity"] })}>{usualIntensityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="text-sm">{recurringTendencyGradingConcerns(item.kind).map((concern) => <SkinGradingHelp concern={concern} context="usual" key={concern} triggerLabel="怎么看这个程度？" />)}</div></div></details>)}
      </section>
    </div>
  );
}

export function LongTermBaselineSummary({ value }: { value: LongTermSkinBaseline }) {
  return (
    <div className="beauty-profile-observations">
      <section aria-labelledby="profile-areas-heading">
        <h2 className="beauty-section-title" id="profile-areas-heading">区域特点</h2>
        <div className="mt-4 space-y-4">
          <Summary label="容易出油" areas={value.usual_oily_areas} />
          <Summary label="容易干" areas={value.usual_dry_areas} />
          {!value.usual_oily_areas.length && !value.usual_dry_areas.length ? <p className="beauty-helper">还没有记录特别的区域，可在编辑档案时补充。</p> : null}
        </div>
      </section>
      <section aria-labelledby="profile-recurring-heading">
        <h2 className="beauty-section-title" id="profile-recurring-heading">反复出现的情况</h2>
        <p className="beauty-helper mt-2">留意平时的规律，不必每天重新填写。</p>
        {value.recurring_tendencies.length ? <ul className="beauty-profile-tendencies">
          {value.recurring_tendencies.map((item) => (
            <li key={item.kind}>
              <p className="text-sm font-medium leading-7">{item.usual_areas.length ? `${item.usual_areas.map((area) => areaLabels[area]).join("、")} · ` : ""}{tendencyLabels[item.kind]}</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">{frequencyLabel(item.frequency ?? item.tendency)} · 通常{usualIntensityLabel(item.usual_intensity)}</p>
            </li>
          ))}
        </ul> : <p className="beauty-helper mt-5">尚未记录反复出现的情况。</p>}
      </section>
    </div>
  );
}

function frequencyLabel(value: LongTermSkinBaseline["recurring_tendencies"][number]["tendency"]) { return frequencyOptions.find(([key]) => key === value)?.[1] ?? "不确定"; }
function Summary({ label, areas: selected }: { label: string; areas: readonly string[] }) { return selected.length ? <div><p className="text-sm font-medium leading-7 text-brand-deep">{label}</p><p className="mt-2 text-sm leading-7">{selected.map((area) => areaLabels[area]).join("、")}</p></div> : null; }
function AreaChoices({ selected, onToggle }: { selected: readonly string[]; onToggle: (area: typeof areas[number][0]) => void }) { return <div className="mt-3 flex flex-wrap gap-2">{areas.map(([area, label]) => <button aria-pressed={selected.includes(area)} className={`beauty-chip ${selected.includes(area) ? "beauty-chip-selected" : ""}`} key={area} onClick={() => onToggle(area)} type="button">{label}</button>)}</div>; }
