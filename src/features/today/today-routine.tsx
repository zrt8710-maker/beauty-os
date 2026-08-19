"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { routineSchema, type Routine, type RoutinePeriod } from "@/schemas/routine";
import { usageHistorySchema } from "@/schemas/usage";

const roleLabels = {
  remover: "卸妆", cleanser: "清洁", hydration: "补水", treatment: "功效护理", moisturizer: "保湿", sunscreen: "防晒",
} as const;

type ProductFeedback = { rating: string; reactionLevel: string; reactionTags: string; textureFeedback: string; notes: string };
const emptyFeedback: ProductFeedback = { rating: "", reactionLevel: "", reactionTags: "", textureFeedback: "", notes: "" };

export function TodayRoutine({ initialRoutine }: { initialRoutine: Routine | null }) {
  const [routine, setRoutine] = useState(initialRoutine);
  const [period, setPeriod] = useState<RoutinePeriod>(initialRoutine?.period ?? "am");
  const [completionStatus, setCompletionStatus] = useState("completed");
  const [overallRating, setOverallRating] = useState("");
  const [skinReactionLevel, setSkinReactionLevel] = useState("");
  const [notes, setNotes] = useState("");
  const [productFeedback, setProductFeedback] = useState<Record<string, ProductFeedback>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function resetUsageForm() {
    setCompletionStatus("completed"); setOverallRating(""); setSkinReactionLevel(""); setNotes(""); setProductFeedback({});
  }

  async function generate() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/routines/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period }) });
      const nextRoutine = parseRoutine(await response.json());
      if (!response.ok || !nextRoutine) throw new Error("GENERATE_FAILED");
      setRoutine(nextRoutine); resetUsageForm();
      setMessage(nextRoutine.steps.length === 0 ? "库存中暂无可用于方案的产品。" : "今日方案已生成。");
    } catch { setMessage("生成失败，请稍后重试。"); } finally { setBusy(false); }
  }

  function updateProductFeedback(ownedProductId: string, field: keyof ProductFeedback, value: string) {
    setProductFeedback((current) => ({ ...current, [ownedProductId]: { ...emptyFeedback, ...current[ownedProductId], [field]: value } }));
  }

  async function saveUsage(endpoint: "complete" | "feedback", forceCompleted = false) {
    if (!routine) return;
    const effectiveStatus = forceCompleted ? "completed" : completionStatus;
    if (effectiveStatus === "skipped" && !notes.trim()) { setMessage("跳过方案时请填写原因。"); return; }
    const products = routine.steps.flatMap((step) => {
      const feedback = productFeedback[step.owned_product_id];
      if (!feedback) return [];
      const rating = feedback.rating ? Number(feedback.rating) : null;
      const reactionLevel = feedback.reactionLevel ? Number(feedback.reactionLevel) : null;
      const reactionTags = feedback.reactionTags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean);
      const textureFeedback = feedback.textureFeedback.trim() || null;
      const productNotes = feedback.notes.trim() || null;
      if (rating === null && reactionLevel === null && !reactionTags.length && !textureFeedback && !productNotes) return [];
      return [{ owned_product_id: step.owned_product_id, rating, reaction_level: reactionLevel, reaction_tags: reactionTags, texture_feedback: textureFeedback, notes: productNotes }];
    });
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/routines/${routine.id}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completion_status: effectiveStatus, overall_rating: overallRating ? Number(overallRating) : null, skin_reaction_level: skinReactionLevel ? Number(skinReactionLevel) : null, notes: notes.trim() || null, products }) });
      if (!response.ok || !parseUsageHistory(await response.json())) throw new Error("USAGE_FAILED");
      resetUsageForm(); setMessage("使用历史已保存，将用于后续规则评分。");
    } catch { setMessage("反馈保存失败，请检查填写内容后重试。"); } finally { setBusy(false); }
  }

  return <section className="rounded-2xl border bg-card p-6 shadow-sm">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-muted-foreground">确定性规则方案</p><h2 className="mt-1 text-xl font-semibold">今日护肤步骤</h2></div><div className="flex items-center gap-2"><select className="h-10 rounded-lg border bg-background px-3 text-sm" onChange={(event) => setPeriod(event.target.value as RoutinePeriod)} value={period}><option value="am">早间</option><option value="pm">晚间</option></select><Button disabled={busy} onClick={generate} type="button">{busy ? "处理中…" : routine ? "重新生成" : "生成今日方案"}</Button></div></div>
    {routine && routine.period === period ? routine.steps.length > 0 ? <ol className="mt-6 space-y-3">{routine.steps.map((step) => {
      const feedback = productFeedback[step.owned_product_id];
      return <li className="rounded-xl border p-4" key={step.id}><p className="text-xs font-medium text-muted-foreground">第 {step.step_order} 步 · {roleLabels[step.role]}</p><p className="mt-1 font-semibold">{step.product.brand_name ? `${step.product.brand_name} · ` : ""}{step.product.product_name}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{step.reason}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><FeedbackSelect label="产品评分" value={feedback?.rating ?? ""} onChange={(value) => updateProductFeedback(step.owned_product_id, "rating", value)} options={[1, 2, 3, 4, 5]} /><FeedbackSelect label="不适反应" value={feedback?.reactionLevel ?? ""} onChange={(value) => updateProductFeedback(step.owned_product_id, "reactionLevel", value)} options={[0, 1, 2, 3, 4]} /><input className="h-9 rounded-md border bg-background px-2 text-sm" placeholder="反应标签，如刺痛、泛红" value={feedback?.reactionTags ?? ""} onChange={(event) => updateProductFeedback(step.owned_product_id, "reactionTags", event.target.value)} /><input className="h-9 rounded-md border bg-background px-2 text-sm" placeholder="质地反馈" value={feedback?.textureFeedback ?? ""} onChange={(event) => updateProductFeedback(step.owned_product_id, "textureFeedback", event.target.value)} /></div></li>;
    })}</ol> : <EmptyState /> : <EmptyState text="选择时段后生成方案。方案只会使用你的现有库存。" />}
    {routine?.period === period && routine.steps.length ? <div className="mt-6 rounded-xl border p-4"><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">执行状态<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={completionStatus} onChange={(event) => setCompletionStatus(event.target.value)}><option value="completed">已完成</option><option value="partial">部分完成</option><option value="skipped">跳过</option></select></label><FeedbackSelect label="整体评分" value={overallRating} onChange={setOverallRating} options={[1, 2, 3, 4, 5]} /><FeedbackSelect label="整体不适" value={skinReactionLevel} onChange={setSkinReactionLevel} options={[0, 1, 2, 3, 4]} /></div><textarea className="mt-3 min-h-20 w-full rounded-md border bg-background p-2 text-sm" placeholder={completionStatus === "skipped" ? "请填写跳过原因（必填）" : "补充本次使用感受（可选）"} value={notes} onChange={(event) => setNotes(event.target.value)} /><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => saveUsage("complete", true)} type="button">完成方案</Button><Button disabled={busy} onClick={() => saveUsage("feedback")} type="button" variant="outline">保存反馈</Button></div></div> : null}
    {routine?.period === period && routine.excluded_products.length ? <details className="mt-5 rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">本次未使用的产品（{routine.excluded_products.length}）</summary><ul className="mt-3 space-y-2">{routine.excluded_products.map((excluded) => <li className="text-sm text-muted-foreground" key={excluded.owned_product_id}><span className="font-medium text-foreground">{excluded.brand_name ? `${excluded.brand_name} · ` : ""}{excluded.product_name}</span>：{excluded.reason}（{excluded.reason_code}）</li>)}</ul></details> : null}
    {message ? <p className="mt-4 text-sm text-muted-foreground">{message}</p> : null}
  </section>;
}

function EmptyState({ text = "暂无可用产品。请先录入未归档、未用完且未明确过期的护肤品。" }: { text?: string }) { return <div className="mt-6 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{text}</div>; }
function FeedbackSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: number[] }) { return <label className="text-sm">{label}<select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={value} onChange={(event) => onChange(event.target.value)}><option value="">未填写</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function parseRoutine(payload: unknown): Routine | null { if (typeof payload !== "object" || payload === null || !("data" in payload)) return null; const result = routineSchema.safeParse(payload.data); return result.success ? result.data : null; }
function parseUsageHistory(payload: unknown) { if (typeof payload !== "object" || payload === null || !("data" in payload)) return null; const result = usageHistorySchema.safeParse(payload.data); return result.success ? result.data : null; }
