"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PRODUCT_TYPE_META, PRODUCT_TYPES } from "@/schemas/product";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";
import type { ProductKnowledgeCompleteness } from "@/server/services/product-knowledge-completeness-service";
import { displayIngredientName } from "@/features/admin/ingredient-display";

type FormState = {
  overall_confidence: string; ingredient_status: ProductResearchDraft["research_payload"]["ingredients"]["status"];
  raw_text: string; ingredient_text: string; item_names: string[]; claims: string[]; product_type: string; texture: string;
  instructions: string; am: boolean; pm: boolean; frequency: string; routine_order: string;
  leave_on: "unknown" | "yes" | "no"; rinse_off: "unknown" | "yes" | "no"; cautions: string;
};

export function ProductKnowledgeMaintenanceForm({ catalogProductId, completeness, snapshot }: {
  catalogProductId: string; completeness: ProductKnowledgeCompleteness; snapshot: ProductResearchDraft | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(snapshot));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const readOnly = !snapshot;
  const payload = snapshot?.research_payload ?? null;
  const missing = collectMissing(payload, completeness);
  const uncertainties = payload ? [...payload.identity.uncertainties, ...payload.uncertainties] : [];
  const conflicts = payload ? [...payload.ingredients.conflicts, ...payload.conflicts] : [];
  const uncertaintyDetails = payload ? uncertainties.map((item) => describeUncertainty(item, payload)) : [];
  const consumerClaims = consumerFacingClaimTexts(payload?.claims ?? []);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateClaim = (index: number, value: string) => set("claims", form.claims.map((claim, current) => current === index ? value : claim));

  async function save() {
    if (!snapshot) return;
    setSaving(true); setMessage(null);
    const response = await fetch(`/api/v1/admin/knowledge/products/${catalogProductId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        overall_confidence: form.overall_confidence === "" ? null : Number(form.overall_confidence),
        ingredients: { status: form.ingredient_status, raw_text: lines(form.raw_text), item_names: lines(form.ingredient_text) },
        claims: form.claims.map((claim) => claim.trim()).filter(Boolean), product_type: form.product_type || null, texture: form.texture.trim() || null,
        usage: { instructions: lines(form.instructions), am_pm: [form.am ? "am" : null, form.pm ? "pm" : null].filter(Boolean), frequency: form.frequency.trim() || null, routine_order: form.routine_order.trim() || null, leave_on: toBoolean(form.leave_on), rinse_off: toBoolean(form.rinse_off), cautions: lines(form.cautions) },
      }),
    });
    const result = await response.json(); setSaving(false);
    if (!response.ok) { setMessage(result.error?.message ?? "保存失败。"); return; }
    setMessage("已保存为新的管理员维护版本。"); router.refresh();
  }

  return <div className="space-y-6">
    <Subsection title="研究可信度">
      {readOnly ? <p className="text-sm text-muted-foreground">尚无可编辑的研究快照。请先在页面底部重新研究。</p> : null}
      <p className="text-sm text-muted-foreground">这是模型研究置信度经确定性来源上限约束后的结果，不是资料完整度评分。</p>
      <Field label="研究可信度（0–100）"><input className="w-32 rounded-lg border bg-background px-3 py-2" disabled={readOnly} id="overall-confidence" max="100" min="0" onChange={(event) => set("overall_confidence", event.target.value)} type="number" value={form.overall_confidence} /></Field>
    </Subsection>

      <Subsection title="成分">
        <label className="block text-sm">状态 <select className="ml-2 rounded border bg-background px-2 py-1" disabled={readOnly} onChange={(event) => set("ingredient_status", event.target.value as FormState["ingredient_status"])} value={form.ingredient_status}>{["found", "partial", "conflicted", "unknown"].map((value) => <option key={value} value={value}>{ingredientStatusLabel(value)}</option>)}</select></label>
        <p className="text-sm text-muted-foreground">{ingredientStatusHelp(completeness.fields.ingredients)}</p>
        <Field label="中文可读成分列表（每行一项）"><textarea aria-label="中文可读成分列表" className="min-h-48 w-full resize-y rounded-lg border bg-background px-3 py-3 leading-6" disabled={readOnly} onChange={(event) => set("ingredient_text", event.target.value)} value={form.ingredient_text} /></Field>
        <details className="rounded-lg border border-dashed p-3"><summary className="cursor-pointer text-sm font-medium">查看原始来源文本</summary><p className="mt-2 text-xs text-muted-foreground">原始成分声明仅用于来源审计；主界面优先展示可读成分列表。</p><textarea aria-label="原始成分声明（每行一份来源文本）" className="mt-3 min-h-44 w-full resize-y rounded-lg border bg-background px-3 py-3 leading-6" disabled={readOnly} onChange={(event) => set("raw_text", event.target.value)} value={form.raw_text} /></details>
      </Subsection>

      <Subsection title="公开宣称">
        <div><p className="mb-2 text-sm font-medium">中文结构化表达</p><InfoList values={consumerClaims} empty="当前版本没有中文结构化宣称；来源原文仍保留供审计。" /></div>
        <details className="rounded-lg border border-dashed p-3"><summary className="cursor-pointer text-sm font-medium">查看和维护来源原文</summary><p className="mt-2 text-xs text-muted-foreground">这里保留来源语言，不会为了中文展示改写原始宣称。</p><div className="mt-3 space-y-2">{form.claims.map((claim, index) => <div className="flex gap-2" key={`${index}-${claim}`}><input className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2" disabled={readOnly} onChange={(event) => updateClaim(index, event.target.value)} value={claim} /><button className="rounded-lg border px-3 text-sm disabled:opacity-60" disabled={readOnly} onClick={() => set("claims", form.claims.filter((_, current) => current !== index))} type="button">删除</button></div>)}</div><button className="mt-3 rounded-lg border px-3 py-2 text-sm disabled:opacity-60" disabled={readOnly} onClick={() => set("claims", [...form.claims, ""])} type="button">添加来源宣称</button></details>
      </Subsection>
      <Subsection title="产品类型"><select className="rounded-lg border bg-background px-3 py-2" disabled={readOnly} onChange={(event) => set("product_type", event.target.value)} value={form.product_type}><option value="">未知</option>{PRODUCT_TYPES.map((type) => <option key={type} value={type}>{PRODUCT_TYPE_META[type].label}（{type}）</option>)}</select></Subsection>
      <Subsection title="质地"><Field label="质地描述"><input className="w-full rounded-lg border bg-background px-3 py-2" disabled={readOnly} onChange={(event) => set("texture", event.target.value)} value={form.texture} /></Field></Subsection>
      <Subsection title="使用方法与注意事项"><Field label="使用步骤（每行一条）"><textarea className="min-h-36 w-full resize-y rounded-lg border bg-background px-3 py-3 leading-6" disabled={readOnly} onChange={(event) => set("instructions", event.target.value)} value={form.instructions} /></Field><div className="flex gap-4 text-sm"><label><input checked={form.am} disabled={readOnly} onChange={(event) => set("am", event.target.checked)} type="checkbox" /> AM</label><label><input checked={form.pm} disabled={readOnly} onChange={(event) => set("pm", event.target.checked)} type="checkbox" /> PM</label></div><div className="grid gap-4 sm:grid-cols-2"><Field label="使用频率"><input className="w-full rounded-lg border bg-background px-3 py-2" disabled={readOnly} onChange={(event) => set("frequency", event.target.value)} value={form.frequency} /></Field><Field label="使用顺序"><input className="w-full rounded-lg border bg-background px-3 py-2" disabled={readOnly} onChange={(event) => set("routine_order", event.target.value)} value={form.routine_order} /></Field></div><div className="flex flex-wrap gap-5"><BooleanSelect disabled={readOnly} label="免洗" value={form.leave_on} onChange={(value) => set("leave_on", value)} /><BooleanSelect disabled={readOnly} label="冲洗" value={form.rinse_off} onChange={(value) => set("rinse_off", value)} /></div><Field label="注意事项（每行一条）"><textarea className="min-h-32 w-full resize-y rounded-lg border bg-background px-3 py-3 leading-6" disabled={readOnly} onChange={(event) => set("cautions", event.target.value)} value={form.cautions} /></Field></Subsection>
      <Subsection title="当前缺失资料"><p className="text-sm text-muted-foreground">Beauty OS 尚未取得足够可用的资料。</p><InfoList values={missing} empty="当前没有需要优先补充的核心资料。" /></Subsection>
      <Subsection title="当前不确定信息"><p className="text-sm text-muted-foreground">已有信息存在，但其精确版本或含义尚不能确认；这不会自动使全部成分事实不可用。</p><InfoList values={uncertaintyDetails} empty="暂无已记录的不确定信息。" /></Subsection>
      <Subsection title="来源信息冲突"><p className="text-sm text-muted-foreground">外部来源对同一产品事实存在分歧，不表示成分相互作用或护肤兼容性。</p><InfoList values={conflicts.map((item) => `${item.field}：${item.values.join(" / ")}`)} empty="暂无已发现的资料冲突。" /></Subsection>
    <section className="rounded-2xl border bg-card p-6 shadow-sm"><h2 className="text-xl font-semibold">保存修改</h2><p className="mt-2 text-sm text-muted-foreground">保存会创建新的管理员维护研究版本。</p>{message ? <p className="mt-3 rounded-xl border p-3 text-sm">{message}</p> : null}<button className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={readOnly || saving} onClick={() => void save()} type="button">{saving ? "保存中…" : "保存修改"}</button></section>
  </div>;
}

function toForm(snapshot: ProductResearchDraft | null): FormState { const p = snapshot?.research_payload; const items = p?.ingredients.items ?? []; return { overall_confidence: snapshot?.overall_confidence?.toString() ?? "", ingredient_status: p?.ingredients.status ?? "unknown", raw_text: p?.ingredients.raw_text.join("\n") ?? "", ingredient_text: items.map((item) => displayIngredientName(item)).join("\n"), item_names: items.map((item) => item.raw_name) ?? [], claims: p?.claims.map((claim) => claim.raw_text) ?? [], product_type: p?.product_type.value ?? "", texture: p?.texture?.value ?? "", instructions: p?.usage.instructions.join("\n") ?? "", am: p?.usage.am_pm.includes("am") ?? false, pm: p?.usage.am_pm.includes("pm") ?? false, frequency: p?.usage.frequency ?? "", routine_order: p?.usage.routine_order ?? "", leave_on: fromBoolean(p?.usage.leave_on ?? null), rinse_off: fromBoolean(p?.usage.rinse_off ?? null), cautions: p?.usage.cautions.join("\n") ?? "" }; }
function lines(value: string) { return value.split("\n").map((item) => item.trim()).filter(Boolean); }
function fromBoolean(value: boolean | null): "unknown" | "yes" | "no" { return value === null ? "unknown" : value ? "yes" : "no"; }
function toBoolean(value: "unknown" | "yes" | "no") { return value === "unknown" ? null : value === "yes"; }
export function consumerFacingClaimTexts(claims: ProductResearchDraft["research_payload"]["claims"]) {
  return claims.flatMap((claim) => {
    if (claim.normalized_claim && containsChinese(claim.normalized_claim)) return [claim.normalized_claim];
    return containsChinese(claim.raw_text) ? [claim.raw_text] : [];
  });
}
function containsChinese(value: string) { return /[\u3400-\u9fff]/u.test(value); }
function collectMissing(payload: ProductResearchDraft["research_payload"] | null, completeness: ProductKnowledgeCompleteness) { if (!payload) return ["尚未生成可维护的研究资料。"]; const missing: string[] = []; if (completeness.fields.ingredients === "partial") missing.push("部分结构化成分缺少可用来源证据。"); if (completeness.fields.ingredients === "missing" || payload.ingredients.status === "unknown") missing.push("成分资料未获取。"); if (completeness.fields.product_type === "missing") missing.push("产品类型未获取。"); if (completeness.fields.usage === "missing" || completeness.fields.usage === "partial") missing.push("使用方法未获取或仅部分获取。"); if (completeness.fields.cautions === "missing") missing.push("未发现产品特异注意事项；这不表示产品没有注意事项。"); return missing; }
function ingredientStatusLabel(value: string) { return ({ found: "完整获取", partial: "部分获取", conflicted: "来源有冲突", unknown: "未获取" } as Record<string, string>)[value] ?? value; }
function ingredientStatusHelp(state: ProductKnowledgeCompleteness["fields"]["ingredients"]) { return ({ complete: "可用：现有结构化成分事实均有来源支持；原始 INCI 仅作为研究证据保留。", partial: "部分可用：已有结构化成分事实，但部分事实缺少可用来源证据。", missing: "未获取：Beauty OS 当前没有可用的结构化成分资料，不表示产品没有成分。", uncertain: "成分资料存在明确来源冲突，需人工核对。" } as Record<string, string>)[state]; }
function describeUncertainty(item: ProductResearchDraft["research_payload"]["uncertainties"][number], payload: ProductResearchDraft["research_payload"]) {
  const sourceTitles = item.evidence_refs.flatMap((ref) => {
    const source = payload.sources.find((candidate) => candidate.source_id === ref);
    return source ? [`${source.title}（${ref}）`] : [ref];
  });
  return `${item.field}：${item.description}${sourceTitles.length ? `；相关来源：${sourceTitles.join("、")}` : ""}`;
}
function Subsection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm"><h2 className="text-xl font-semibold">{title}</h2>{children}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-2 text-sm"><span>{label}</span>{children}</label>; }
function InfoList({ values, empty }: { values: string[]; empty: string }) { return values.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>; }
function BooleanSelect({ disabled, label, value, onChange }: { disabled: boolean; label: string; value: "unknown" | "yes" | "no"; onChange: (value: "unknown" | "yes" | "no") => void }) { return <label className="block text-sm">{label}<select className="ml-2 rounded border bg-background px-2 py-1" disabled={disabled} onChange={(event) => onChange(event.target.value as "unknown" | "yes" | "no")} value={value}><option value="unknown">未知</option><option value="yes">是</option><option value="no">否</option></select></label>; }
