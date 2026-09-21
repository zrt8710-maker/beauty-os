"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { SkinGradingHelp } from "@/features/skin-grading/skin-grading-help";
import type { DailyState, DailyStateArea, DailyStateConcern, DailyStateConcernKind, SkinCheckinField, SkinCheckinInput } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";
import { applyBaselineOverrideSelection, baselineSpecs, isSemanticallyValidDailyConcern } from "@/features/check-in/effective-daily-skin-state";

type Props = {
  draft: SkinCheckinInput;
  profile: Pick<Profile, "long_term_skin_baseline"> | null;
  saving: boolean;
  message: string;
  onChange: (draft: SkinCheckinInput) => void;
  onCancel: () => void;
  onSave: () => void;
};

const concernOptions: Array<{ value: DailyStateConcernKind; label: string }> = [
  { value: "oiliness", label: "出油" }, { value: "dryness", label: "发干" }, { value: "flaking", label: "起皮" }, { value: "roughness", label: "粗糙" }, { value: "redness", label: "泛红" }, { value: "stinging", label: "刺痛" }, { value: "itching", label: "发痒" }, { value: "burning", label: "灼热感" }, { value: "blemishes", label: "痘痘" }, { value: "small_bumps", label: "小颗粒" }, { value: "blackheads", label: "黑头" }, { value: "visible_pores", label: "毛孔明显" }, { value: "uneven_tone", label: "肤色不均" }, { value: "dullness", label: "暗沉" }, { value: "post_blemish_marks", label: "痘印" },
];
const areaOptions: Array<{ value: DailyStateArea; label: string }> = [
  { value: "t_zone", label: "T 区" }, { value: "forehead", label: "额头" }, { value: "hairline", label: "发际线" }, { value: "nose", label: "鼻子" }, { value: "nose_wings", label: "鼻翼" }, { value: "cheeks", label: "脸颊" }, { value: "chin", label: "下巴" }, { value: "eye_area", label: "眼周" }, { value: "full_face", label: "全脸" }, { value: "other", label: "其他局部" },
];
const areaLabels = { ...Object.fromEntries(areaOptions.map((item) => [item.value, item.label])), full_face: "全脸" } as Record<string, string>;
const concernLabels = Object.fromEntries(concernOptions.map((item) => [item.value, item.label])) as Record<DailyStateConcernKind, string>;
const comparisonOptions = [{ value: "usual", label: "与平时接近" }, { value: "more_than_usual", label: "今天更明显" }, { value: "less_than_usual", label: "今天更轻" }, { value: "unknown", label: "不确定" }] as const;

export function DailySkinEditView({ draft, profile, saving, message, onChange, onCancel, onSave }: Props) {
  const [baselineSelections, setBaselineSelections] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [addKind, setAddKind] = useState<DailyStateConcernKind>("oiliness");
  const [addArea, setAddArea] = useState<DailyStateArea>("t_zone");
  const state = useMemo(() => asV2State(draft.daily_state), [draft.daily_state]);
  const inherited = useMemo(() => baselineCandidates(profile), [profile]);

  function updateConcern(index: number, patch: Partial<DailyStateConcern>) {
    const concerns = state.concerns.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch, source: [...new Set([...item.source, "manual" as const])] } : item);
    onChange(withDailyState(draft, { ...state, concerns }));
  }
  function removeConcern(index: number) {
    onChange(withDailyState(draft, { ...state, concerns: state.concerns.filter((_, itemIndex) => itemIndex !== index) }));
  }
  function updateBaseline(candidate: BaselineCandidate, selection: string) {
    setBaselineSelections((current) => ({ ...current, [candidate.key]: selection }));
    if (selection === "today_recorded") return;
    onChange(withDailyState(draft, { ...state, concerns: applyBaselineOverrideSelection(state.concerns, { concern: candidate.kind, area: candidate.area }, selection as "inherit" | "absent" | "usual" | "more_than_usual" | "less_than_usual") }));
  }
  function addConcern() {
    const concern: DailyStateConcern = { kind: addKind, status: "present", areas: [addArea], attributes: { severity: "mild", baseline_comparison: "unknown" }, user_wording: [], source: ["manual"], interaction_origin: "unknown", area_origin: "user_confirmed" };
    onChange(withDailyState(draft, { ...state, concerns: [...state.concerns, concern] }));
    setAdding(false);
  }

  return <section aria-label="调整今天的皮肤状态" className="space-y-6 rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
    <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between"><div><p className="beauty-meta">{draft.recorded_date}</p><h2 className="mt-1 text-2xl leading-snug font-semibold tracking-[-0.02em]">调整今天的状态</h2></div><div className="flex gap-2"><Button onClick={onCancel} type="button" variant="outline">取消</Button><Button disabled={saving} onClick={onSave} type="button"><BeautyNavIcon name="save" size={16} />{saving ? "保存中…" : "保存调整"}</Button></div></header>
    <section><SectionTitle title="今天已确认的状态" description="只显示今天对话或手动记录中已经确认的内容。" />{state.concerns.some(isSemanticallyValidDailyConcern) ? <div className="mt-4 space-y-4">{state.concerns.map((concern, index) => isSemanticallyValidDailyConcern(concern) ? <TodayConcernCard concern={concern} key={`${concern.kind}:${index}`} onChange={(patch) => updateConcern(index, patch)} onDelete={() => removeConcern(index)} /> : null)}</div> : <p className="mt-4 text-sm text-muted-foreground">今天还没有可调整的已确认状态。</p>}</section>
    {inherited.length ? <section className="border-t pt-6"><SectionTitle title="长期状态参考" description="这些是长期档案中的默认状态；选择“沿用”不会写入今天的记录。" /><div className="mt-4 space-y-3">{inherited.map((candidate) => <BaselineCandidateCard candidate={candidate} key={candidate.key} onChange={(selection) => updateBaseline(candidate, selection)} value={baselineSelections[candidate.key] ?? baselineSelection(candidate, state.concerns)} />)}</div></section> : null}
    <section className="border-t pt-6"><SectionTitle title="补充今天的其他状态" description="只添加你今天想明确记录的内容。" />{adding ? <div className="mt-4 grid gap-3 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-3"><Select label="状态" onChange={(value) => setAddKind(value as DailyStateConcernKind)} options={concernOptions} value={addKind} /><Select label="区域" onChange={(value) => setAddArea(value as DailyStateArea)} options={areaOptions} value={addArea} /><div className="flex items-end gap-2"><Button onClick={addConcern} type="button">添加</Button><Button onClick={() => setAdding(false)} type="button" variant="outline">取消</Button></div></div> : <Button className="mt-4" onClick={() => setAdding(true)} type="button" variant="outline">+ 补充今天的其他状态</Button>}</section>
    {message ? <p aria-live="polite" className="text-sm text-destructive">{message}</p> : null}
  </section>;
}

function TodayConcernCard({ concern, onChange, onDelete }: { concern: DailyStateConcern; onChange: (patch: Partial<DailyStateConcern>) => void; onDelete: () => void }) {
  const area = concern.areas[0] ?? null;
  const comparison = concern.attributes.baseline_comparison ?? "unknown";
  const severity = concern.status === "absent" ? "absent" : concern.attributes.severity ?? "mild";
  const supportsAmount = ["blemishes", "small_bumps", "blackheads", "visible_pores", "flaking"].includes(concern.kind);
  return <article className="rounded-2xl border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-medium">{area ? `${areaLabels[area]} · ` : "区域未指定 · "}{concernLabels[concern.kind]}</p><p className="mt-1 text-sm text-muted-foreground">只调整今天的事实；长期背景不会自动写入。</p></div><Button onClick={onDelete} type="button" variant="ghost">删除这项</Button></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><Select label="区域" onChange={(value) => { if (value) onChange({ areas: [value as DailyStateArea], area_origin: "user_confirmed" }); }} options={[{ value: "", label: "区域未指定" }, ...areaOptions]} value={area ?? ""} /><Select label={supportsAmount ? "今天数量" : "今天程度"} onChange={(value) => onChange(value === "absent" ? { status: "absent", attributes: { ...concern.attributes, severity: undefined, amount: undefined } } : supportsAmount ? { status: "present", attributes: { ...concern.attributes, amount: value as DailyStateConcern["attributes"]["amount"] } } : { status: "present", attributes: { ...concern.attributes, severity: value as DailyStateConcern["attributes"]["severity"] } })} options={supportsAmount ? [{ value: "absent", label: "今天没有" }, { value: "isolated", label: "零散" }, { value: "few", label: "少量" }, { value: "several", label: "几处" }, { value: "many", label: "较多" }, { value: "widespread", label: "范围较广" }] : [{ value: "absent", label: "今天没有" }, { value: "slight", label: "轻微" }, { value: "mild", label: "有一些" }, { value: "moderate", label: "比较明显" }, { value: "marked", label: "很明显" }]} value={supportsAmount ? (concern.status === "absent" ? "absent" : concern.attributes.amount ?? "few") : severity} /><Select label="和平时相比" onChange={(value) => onChange({ attributes: { ...concern.attributes, baseline_comparison: value as DailyStateConcern["attributes"]["baseline_comparison"] } })} options={comparisonOptions} value={comparison} /></div><SkinGradingHelp concern={concern.kind} triggerLabel="怎么看？" />{concern.kind === "dryness" ? <DrynessCompanions /> : null}</article>;
}

function DrynessCompanions() {
  return <p className="mt-4 text-sm text-muted-foreground">如果今天还想补充粗糙或起皮，可以用下方“补充今天的其他状态”分别添加。</p>;
}

function BaselineCandidateCard({ candidate, value, onChange }: { candidate: BaselineCandidate; value: string; onChange: (value: string) => void }) { return <article className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{areaLabels[candidate.area]} · {concernLabels[candidate.kind]}</p><p className="mt-1 text-sm text-muted-foreground">长期状态：平时较容易出现。</p></div><Select label="今天" onChange={onChange} options={[{ value: "inherit", label: "沿用长期状态" }, { value: "today_recorded", label: "已按今天记录" }, { value: "absent", label: "今天没有" }, ...comparisonOptions]} value={value} /></article>; }
function SectionTitle({ title, description }: { title: string; description: string }) { return <div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>; }
function Select({ label, options, value, onChange }: { label: string; options: ReadonlyArray<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) { return <label className="block text-sm font-medium"><span>{label}</span><select className="beauty-field mt-2 font-normal" onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }

type BaselineCandidate = { key: string; kind: DailyStateConcernKind; area: DailyStateArea };
function baselineCandidates(profile: Pick<Profile, "long_term_skin_baseline"> | null): BaselineCandidate[] { return baselineSpecs(profile).filter((candidate) => candidate.area !== "full_face").slice(0, 4).map(({ key, concern: kind, area }) => ({ key, kind, area })); }
function isManualBaselineOverride(concern: DailyStateConcern, candidate: BaselineCandidate) { return concern.source.includes("manual") && concern.kind === candidate.kind && concern.areas.includes(candidate.area); }
function baselineSelection(candidate: BaselineCandidate, concerns: DailyStateConcern[]) {
  const manual = concerns.find((concern) => isManualBaselineOverride(concern, candidate));
  if (manual) return manual.status === "absent" ? "absent" : manual.attributes.baseline_comparison === "less_than_usual" ? "less_than_usual" : manual.attributes.baseline_comparison === "more_than_usual" ? "more_than_usual" : "usual";
  return concerns.some((concern) => concern.kind === candidate.kind && concern.areas.includes(candidate.area)) ? "today_recorded" : "inherit";
}

function asV2State(value: DailyState | null): Extract<DailyState, { version: 2 }> { return value?.version === 2 ? value : { version: 2, summary: value?.version === 1 ? value.summary : null, concerns: [] }; }
function withDailyState(draft: SkinCheckinInput, state: Extract<DailyState, { version: 2 }>): SkinCheckinInput {
  const prior = draft.daily_state?.version === 2 ? draft.daily_state.concerns : [];
  const affected = new Set([...prior, ...state.concerns].map((concern) => canonicalFieldFor(concern.kind)).filter((field): field is SkinCheckinField => field !== null));
  const next = { ...draft, daily_state: state.summary || state.concerns.length ? state : null, known_fields: [...draft.known_fields], field_provenance: { ...draft.field_provenance } };
  for (const field of affected) {
    const related = state.concerns.filter((concern) => canonicalFieldFor(concern.kind) === field);
    if (!related.length) {
      next.known_fields = next.known_fields.filter((item) => item !== field);
      delete next.field_provenance[field];
      next[field] = 0;
      continue;
    }
    next.known_fields = [...new Set([...next.known_fields, field])];
    next.field_provenance[field] = ["manual"];
    next[field] = Math.max(...related.map(canonicalLevelFor));
  }
  return next;
}
function canonicalFieldFor(kind: DailyStateConcernKind): SkinCheckinField | null {
  if (kind === "oiliness") return "oiliness_level";
  if (["dryness", "flaking", "roughness"].includes(kind)) return "dryness_level";
  if (kind === "redness") return "redness_level";
  if (["stinging", "itching", "burning"].includes(kind)) return "sensitivity_level";
  if (["blemishes", "small_bumps"].includes(kind)) return "acne_level";
  return null;
}
function canonicalLevelFor(concern: DailyStateConcern) {
  if (concern.status === "absent") return 0;
  const severity = concern.attributes.severity;
  if (severity === "slight") return 1;
  if (severity === "mild") return 2;
  if (severity === "moderate") return 3;
  if (severity === "marked") return 4;
  const amount = concern.attributes.amount;
  if (amount === "isolated" || amount === "few") return 1;
  if (amount === "several") return 2;
  if (amount === "many") return 3;
  if (amount === "widespread") return 4;
  return 2;
}
