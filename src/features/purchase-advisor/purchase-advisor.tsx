"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { CatalogProduct } from "@/schemas/knowledge";
import { purchaseAnalysisSchema, type PurchaseAnalysis } from "@/schemas/purchase-analysis";
import { PRODUCT_TYPE_META, type ProductType } from "@/schemas/product";

const decisions = { consider_buy: "可以考虑购买", wait: "建议等待", do_not_buy: "不建议购买", insufficient_data: "信息不足" } as const;

export function PurchaseAdvisor({ catalogProducts, initialAnalyses }: { catalogProducts: CatalogProduct[]; initialAnalyses: PurchaseAnalysis[] }) {
  const [mode, setMode] = useState<"catalog" | "manual">(catalogProducts.length ? "catalog" : "manual");
  const [catalogId, setCatalogId] = useState(catalogProducts[0]?.id ?? "");
  const [productName, setProductName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [productType, setProductType] = useState<ProductType>("serum");
  const [ingredients, setIngredients] = useState("");
  const [analyses, setAnalyses] = useState(initialAnalyses);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function analyze() {
    if (mode === "manual" && !productName.trim()) { setMessage("请填写候选产品名称。"); return; }
    if (mode === "catalog" && !catalogId) { setMessage("当前没有可选择的已验证目录产品。"); return; }
    setBusy(true); setMessage("");
    const metadata = PRODUCT_TYPE_META[productType];
    const body = mode === "catalog" ? { catalog_product_id: catalogId } : { candidate_snapshot: { brand_name: brandName.trim() || null, product_name: productName.trim(), category: metadata.category, product_type: productType, ingredients: ingredients.split(/[，,]/).map((item) => item.trim()).filter(Boolean) } };
    try {
      const response = await fetch("/api/v1/purchase-analyses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload: unknown = await response.json();
      const analysis = parseAnalysis(payload);
      if (!response.ok || !analysis) throw new Error("ANALYSIS_FAILED");
      setAnalyses((current) => [analysis, ...current]);
      setMessage("购买判断已生成并保存。");
    } catch { setMessage("无法生成购买判断，请检查输入后重试。"); } finally { setBusy(false); }
  }

  return <div className="space-y-7"><section className="rounded-2xl border bg-card p-6"><div className="flex gap-2"><Button type="button" variant={mode === "catalog" ? "default" : "outline"} onClick={() => setMode("catalog")}>选择知识库产品</Button><Button type="button" variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode("manual")}>手工输入</Button></div>{mode === "catalog" ? <label className="mt-5 block text-sm font-medium">候选产品<select className={inputClass} value={catalogId} onChange={(event) => setCatalogId(event.target.value)}><option value="">请选择</option>{catalogProducts.map((product) => <option key={product.id} value={product.id}>{product.brand_name} · {product.product_name}</option>)}</select></label> : <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="品牌（可选）"><input className={inputClass} value={brandName} onChange={(event) => setBrandName(event.target.value)} /></Field><Field label="我想买"><input className={inputClass} placeholder="候选产品名称" value={productName} onChange={(event) => setProductName(event.target.value)} /></Field><Field label="产品类型"><select className={inputClass} value={productType} onChange={(event) => setProductType(event.target.value as ProductType)}>{Object.entries(PRODUCT_TYPE_META).map(([type, meta]) => <option key={type} value={type}>{meta.label}</option>)}</select></Field><Field label="已知成分（可选，逗号分隔）"><input className={inputClass} value={ingredients} onChange={(event) => setIngredients(event.target.value)} /></Field></div>}<Button className="mt-5" disabled={busy} type="button" onClick={analyze}>{busy ? "分析中…" : "判断是否值得购买"}</Button>{message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}</section>{analyses.length ? <div className="space-y-5">{analyses.map((analysis) => <AnalysisCard analysis={analysis} key={analysis.id} />)}</div> : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">尚无购买分析。</p>}</div>;
}

function AnalysisCard({ analysis }: { analysis: PurchaseAnalysis }) {
  const candidate = analysis.candidate_snapshot;
  const warning = analysis.decision === "do_not_buy";
  return <article className={`rounded-2xl border bg-card p-6 ${warning ? "border-destructive/50" : ""}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">{String(candidate.brand_name ?? "")} {String(candidate.product_name ?? "候选产品")}</p><h2 className={`mt-1 text-xl font-semibold ${warning ? "text-destructive" : ""}`}>{decisions[analysis.decision]}</h2></div><div className="text-right"><p className="text-3xl font-semibold">{analysis.final_score}</p><p className="text-xs text-muted-foreground">最终评分 / 100</p></div></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5"><Score label="非重复" value={analysis.duplicate_score} /><Score label="真实缺口" value={analysis.gap_score} /><Score label="适配" value={analysis.compatibility_score} /><Score label="使用概率" value={analysis.usage_probability_score} /><Score label="风险" value={analysis.risk_score} /></div><section className="mt-5"><h3 className="font-medium">已有替代</h3>{analysis.evidence.alternatives.length ? <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{analysis.evidence.alternatives.map((item) => <li key={item.owned_product_id}>{item.brand_name ? `${item.brand_name} · ` : ""}{item.product_name}（剩余 {item.quantity_remaining_percent}%）</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">没有发现同角色可用资产。</p>}</section><section className="mt-4"><h3 className="font-medium">缺口</h3><p className="mt-1 text-sm text-muted-foreground">{analysis.evidence.gap.message}</p></section><section className="mt-4"><h3 className="font-medium">风险</h3><p className="mt-1 text-sm text-muted-foreground">{analysis.evidence.risks.length ? analysis.evidence.risks.join("；") : "未发现明确风险。"}</p></section>{analysis.unknowns.length ? <section className="mt-4 rounded-xl bg-muted p-4"><h3 className="font-medium">未知信息</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{analysis.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}<p className="mt-4 text-xs text-muted-foreground">规则依据：{analysis.reason_codes.join(" · ")}</p></article>;
}
function Score({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium">{label}{children}</label>; }
function parseAnalysis(payload: unknown) { if (typeof payload !== "object" || payload === null || !("data" in payload)) return null; const parsed = purchaseAnalysisSchema.safeParse(payload.data); return parsed.success ? parsed.data : null; }
const inputClass = "mt-2 h-11 w-full rounded-lg border bg-background px-3 font-normal outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
