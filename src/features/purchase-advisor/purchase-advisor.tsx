"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { purchaseAnalysisSchema, type PurchaseAnalysis } from "@/schemas/purchase-analysis";
import {
  productIdentityResolutionSchema,
  type CatalogProductIdentity,
  type ExternalProductIdentity,
} from "@/schemas/product-identity-resolution";

const conclusions = {
  consider_buy: "可以考虑购买",
  wait: "建议先等等",
  do_not_buy: "暂时不建议购买",
  insufficient_data: "先补充一点信息再决定",
} as const;

export function PurchaseAdvisor({ initialAnalyses }: { initialAnalyses: PurchaseAnalysis[] }) {
  const [productName, setProductName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [analyses, setAnalyses] = useState(initialAnalyses);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([]);

  async function analyze() {
    if (!productName.trim()) { setMessage("请填写产品名称。"); return; }
    setBusy(true); setMessage("");
    try {
      const identityResponse = await fetch("/api/v1/product-identity/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity_clue: { source: "manual_search", raw_query: productName.trim(), brand_name: brandName.trim() || null, product_name: productName.trim(), recognition_confidence: null, observed_text: [] }, recognition_reference: null, declined_catalog_product_ids: [] }) });
      const resolution = parseIdentityResolution(await identityResponse.json());
      if (!identityResponse.ok || !resolution) { setMessage("暂时无法确认这件产品，请补充完整产品名称或品牌后重试。"); return; }
      if (resolution.status === "matched") {
        await createAnalysis(resolution.catalog_product_id);
        return;
      }
      if (resolution.status === "catalog_candidates") {
        setCandidates([
          ...resolution.candidates.map((candidate) => ({ kind: "catalog" as const, candidate })),
          ...resolution.fallback_external_candidates.map((candidate) => ({ kind: "external" as const, candidate })),
        ]);
        setMessage("找到可能对应的产品，请确认正确的一款。");
        return;
      }
      if (resolution.status === "external_candidate") {
        setCandidates(resolution.candidates.map((candidate) => ({ kind: "external" as const, candidate })));
        setMessage("找到了公开产品候选，请确认正确的一款。");
        return;
      }
      setMessage("暂时无法确认这件产品，请补充完整产品名称或品牌后重试。");
    } catch (error) { setMessage(error instanceof PurchaseKnowledgeUnavailableError ? "已确认产品身份，但现有产品知识还不足以生成可靠购买判断。" : "无法生成购买判断，请检查输入后重试。"); } finally { setBusy(false); }
  }

  async function createAnalysis(catalogProductId: string) {
    const response = await fetch("/api/v1/purchase-analyses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ catalog_product_id: catalogProductId }) });
    const payload: unknown = await response.json();
    const analysis = parseAnalysis(payload);
    if (!response.ok || !analysis) {
      if (response.status === 404 && responseErrorCode(payload) === "CATALOG_PRODUCT_NOT_FOUND") throw new PurchaseKnowledgeUnavailableError();
      throw new Error("ANALYSIS_FAILED");
    }
    setAnalyses((current) => [analysis, ...current]);
    setCandidates([]);
    setMessage("购买判断已生成并保存。");
  }

  async function confirmCandidate(selection: IdentityCandidate) {
    setBusy(true); setMessage("");
    try {
      if (selection.kind === "catalog") {
        await createAnalysis(selection.candidate.catalog_product_id);
        return;
      }
      const response = await fetch("/api/v1/product-identity/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection.candidate),
      });
      const confirmation = parseExternalConfirmation(await response.json());
      if (!response.ok || !confirmation) throw new Error("CONFIRMATION_FAILED");
      if (!confirmation.analysis_ready) {
        setCandidates([]);
        setMessage("已确认产品身份，但现有产品知识还不足以生成可靠购买判断。");
        return;
      }
      await createAnalysis(confirmation.catalog_product_id);
    } catch (error) { setMessage(error instanceof PurchaseKnowledgeUnavailableError ? "已确认产品身份，但现有产品知识还不足以生成可靠购买判断。" : "暂时无法确认这件产品，请重新查找后再试。"); } finally { setBusy(false); }
  }

  const advisorForm = <section className="border-y border-border/80 py-6 sm:py-8"><h2 className="beauty-section-title">{analyses.length ? "判断另一件产品" : "想买什么？"}</h2><p className="beauty-helper mt-2">填写产品名称；如有品牌信息，一起填写能减少候选范围。</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="品牌（可选）"><input className={inputClass} value={brandName} onChange={(event) => setBrandName(event.target.value)} /></Field><Field label="产品名称"><input className={inputClass} placeholder="例如：双抗精华" value={productName} onChange={(event) => setProductName(event.target.value)} /></Field></div><Button className="mt-5" disabled={busy || !productName.trim()} type="button" onClick={analyze}>{busy ? "正在判断…" : "判断值不值得买"}</Button>{message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}{candidates.length ? <div className="mt-5 space-y-3" aria-label="产品候选">{candidates.map((selection, index) => <button className="flex min-h-11 w-full items-center justify-between gap-4 rounded-xl border border-border/80 bg-card/75 p-4 text-left transition-colors hover:border-ring/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60" disabled={busy} key={`${selection.kind}:${candidateKey(selection)}:${index}`} onClick={() => confirmCandidate(selection)} type="button"><span><span className="block font-medium">{candidateName(selection)}</span><span className="mt-1 block text-sm text-muted-foreground">确认是这款产品</span></span><span aria-hidden="true">→</span></button>)}</div> : null}</section>;

  return <div className="space-y-10">{analyses.length ? <><div className="space-y-10">{analyses.map((analysis) => <AnalysisCard analysis={analysis} key={analysis.id} />)}</div>{advisorForm}</> : <>{advisorForm}<div className="beauty-empty">还没有购买判断。输入一件正在考虑的产品，结果会保存在这里。</div></>}</div>;
}

type IdentityCandidate =
  | { kind: "catalog"; candidate: CatalogProductIdentity }
  | { kind: "external"; candidate: ExternalProductIdentity };

function candidateName(selection: IdentityCandidate) {
  const candidate = selection.candidate;
  return [candidate.brand_name, candidate.product_name, candidate.variant_name].filter(Boolean).join(" · ");
}

function candidateKey(selection: IdentityCandidate) {
  return selection.kind === "catalog" ? selection.candidate.catalog_product_id : selection.candidate.confirmation_id;
}

function AnalysisCard({ analysis }: { analysis: PurchaseAnalysis }) {
  const candidate = analysis.candidate_snapshot;
  const warning = analysis.decision === "do_not_buy";
  const alternatives = analysis.evidence.alternatives;
  const exactOwned = alternatives.filter((item) => item.match === "exact_catalog");
  const sameType = alternatives.filter((item) => item.match === "same_type");
  const matchNotes = matchingNotes(analysis);
  const reflectionNotes = purchaseReflectionNotes(analysis);

  return <article className={`border-t-2 pt-6 sm:pt-7 ${warning ? "border-destructive/55" : "border-petal/55"}`}>
    <div>
      <p className="text-sm text-muted-foreground">{String(candidate.brand_name ?? "")} {String(candidate.product_name ?? "候选产品")}</p>
      <h2 className={`mt-1 text-3xl leading-tight font-semibold tracking-[-0.025em] text-pretty sm:text-4xl ${warning ? "text-destructive" : ""}`}>{conclusions[analysis.decision]}</h2>
    </div>

    <section className="mt-6 max-w-[68ch]">
      <h3 className="font-medium">为什么</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{whyThisConclusion(analysis, exactOwned.length, sameType.length)}</p>
    </section>

    <section className="mt-7 border-t border-border/70 pt-6">
      <h3 className="font-medium">和现有资产的关系</h3>
      {alternatives.length ? <ul className="mt-2 space-y-1 text-sm leading-6 text-muted-foreground">{alternatives.map((item) => <li key={item.owned_product_id}>{alternativeRelationship(item)} {item.brand_name ? `${item.brand_name} · ` : ""}{item.product_name}（剩余 {item.quantity_remaining_percent}%）</li>)}</ul> : <p className="mt-1 text-sm leading-6 text-muted-foreground">目前没有看到可直接替代它的现有产品；它可能是在补充一个尚未覆盖的使用位置。</p>}
    </section>

    <section className="mt-7 border-t border-border/70 pt-6">
      <h3 className="font-medium">与你的匹配</h3>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-muted-foreground">{matchNotes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section>

    <section className="mt-7 border-t border-border/70 pt-6">
      <h3 className="font-medium">购买前想一想</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">{reflectionNotes.map((note) => <li key={note}>{note}</li>)}</ul>
    </section>
  </article>;
}

function whyThisConclusion(analysis: PurchaseAnalysis, exactOwnedCount: number, sameTypeCount: number) {
  if (analysis.evidence.compatibility.avoid_ingredient_matches.length) return "候选产品命中了你已记录的避用成分，因此不建议加入。";
  if (exactOwnedCount > 0) return "你已经拥有同一款产品，继续购买很可能形成重复。";
  if (sameTypeCount > 0) return `你已有 ${sameTypeCount} 件同类型产品，是否购买主要取决于它们是否会在近期被用完。`;
  if (analysis.decision === "insufficient_data") return "现有产品资料或你的皮肤档案还不足以做可靠判断。";
  if (analysis.evidence.risks.length) return "它可能补充现有空缺，但已有使用或耐受风险需要先考虑。";
  return "目前没有看到明确重复；它更像是在补充现有资产尚未覆盖的使用位置。";
}

function alternativeRelationship(item: PurchaseAnalysis["evidence"]["alternatives"][number]) {
  if (item.match === "exact_catalog") return "你已拥有同一款：";
  if (item.match === "same_type") return "你已有同类型产品：";
  return "你已有相近用途的产品：";
}

function matchingNotes(analysis: PurchaseAnalysis) {
  const notes: string[] = [];
  if (analysis.evidence.compatibility.avoid_ingredient_matches.length) notes.push(`命中避用成分：${analysis.evidence.compatibility.avoid_ingredient_matches.join("、")}。`);
  else notes.push("没有发现命中你已记录避用成分的资料。");
  const matchingUnknowns = analysis.unknowns.filter((item) => /皮肤档案|功效声明|成分资料|目录产品/i.test(item));
  if (matchingUnknowns.length) notes.push(...matchingUnknowns);
  else notes.push("现有资料没有显示与肤质或使用偏好冲突的明确迹象。");
  return [...new Set(notes)];
}

function purchaseReflectionNotes(analysis: PurchaseAnalysis) {
  const notes = [...analysis.evidence.risks];
  if (analysis.evidence.usage.recent_usage_count === 0) notes.push("最近没有相近产品的使用反馈，买前可以先确认自己会在什么场景使用它。");
  notes.push(...analysis.unknowns.filter((item) => !/皮肤档案|功效声明|成分资料|目录产品/i.test(item)));
  return [...new Set(notes)].length ? [...new Set(notes)] : ["目前没有发现明显风险；仍建议先确认它能替代或补充你现有产品中的哪一步。"];
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium">{label}{children}</label>; }
function parseIdentityResolution(payload: unknown) { if (typeof payload !== "object" || payload === null || !("data" in payload)) return null; const parsed = productIdentityResolutionSchema.safeParse(payload.data); return parsed.success ? parsed.data : null; }
function parseExternalConfirmation(payload: unknown) { if (typeof payload !== "object" || payload === null || !("data" in payload) || typeof payload.data !== "object" || payload.data === null) return null; const data = payload.data as Record<string, unknown>; return typeof data.catalog_product_id === "string" && typeof data.analysis_ready === "boolean" ? { catalog_product_id: data.catalog_product_id, analysis_ready: data.analysis_ready } : null; }
function parseAnalysis(payload: unknown) { if (typeof payload !== "object" || payload === null || !("data" in payload)) return null; const parsed = purchaseAnalysisSchema.safeParse(payload.data); return parsed.success ? parsed.data : null; }
function responseErrorCode(payload: unknown) { if (typeof payload !== "object" || payload === null || !("error" in payload) || typeof payload.error !== "object" || payload.error === null || !("code" in payload.error)) return null; return typeof payload.error.code === "string" ? payload.error.code : null; }
class PurchaseKnowledgeUnavailableError extends Error {}
const inputClass = "beauty-field mt-2 font-normal";
