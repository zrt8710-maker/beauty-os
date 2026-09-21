"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type ValidationResult = { line: number; product_name: string | null; status: "valid" | "invalid"; reason?: string };
type ValidationReport = { total: number; valid: number; invalid: number; results: ValidationResult[] };
type ImportResult = {
  line: number; product_name: string | null; catalog_product_id: string | null; status: "success" | "failed";
  reason?: string; research_version?: number; catalog_product_created?: boolean; image_updated?: boolean;
};
type ImportReport = { success_count: number; failed_count: number; results: ImportResult[] };

export function ProductKnowledgeBulkImport() {
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"validate" | "import" | null>(null);

  async function send(action: "validate" | "import") {
    if (!file) return;
    setBusy(action);
    setMessage(null);
    if (action === "validate") { setValidation(null); setReport(null); }
    try {
      const response = await fetch(`/api/v1/admin/knowledge/bulk-import/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonl: await file.text() }),
      });
      const body = await response.json() as { data?: ValidationReport | ImportReport; error?: { message?: string } };
      if (!response.ok) {
        setMessage(body.error?.message ?? "请求未能完成，请稍后重试。");
        if (action === "import" && body.data && "invalid" in body.data) setValidation(body.data as ValidationReport);
        return;
      }
      if (action === "validate") setValidation(body.data as ValidationReport);
      else setReport(body.data as ImportReport);
    } catch {
      setMessage("网络请求未能完成，请稍后重试。");
    } finally { setBusy(null); }
  }

  return (
    <section className="mt-6 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">批量导入 Product Knowledge</h2>
      <p className="mt-1 text-sm text-muted-foreground">上传 JSONL 后先验证；全部通过才可确认导入。文件不会被永久保存。</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input accept=".jsonl,application/jsonl" aria-label="Product Knowledge JSONL 文件" onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          if (selected && !selected.name.toLowerCase().endsWith(".jsonl")) { setFile(null); setValidation(null); setMessage("请选择 .jsonl 文件。"); return; }
          setFile(selected); setValidation(null); setReport(null); setMessage(null);
        }} type="file" />
        <span className="text-sm text-muted-foreground">{file?.name ?? "未选择文件"}</span>
        <Button disabled={!file || busy !== null} onClick={() => void send("validate")}>{busy === "validate" ? "正在验证…" : "验证文件"}</Button>
        {validation?.invalid === 0 && validation.total > 0 ? <Button disabled={busy !== null} onClick={() => void send("import")}>{busy === "import" ? "正在导入…" : "确认导入"}</Button> : null}
      </div>
      {message ? <p className="mt-3 text-sm text-destructive" role="alert">{message}</p> : null}
      {validation ? <ValidationView report={validation} /> : null}
      {report ? <ImportView report={report} /> : null}
    </section>
  );
}

function ValidationView({ report }: { report: ValidationReport }) {
  const invalid = report.results.filter((item) => item.status === "invalid");
  return <div className="mt-4 text-sm"><p>共 {report.total} 行 · 有效 {report.valid} · 无效 {report.invalid}</p>{invalid.length ? <ul className="mt-2 space-y-1 text-destructive">{invalid.map((item) => <li key={item.line}>第 {item.line} 行：{item.reason}</li>)}</ul> : <p className="mt-2 text-emerald-700">验证通过，可以确认导入。</p>}</div>;
}

function ImportView({ report }: { report: ImportReport }) {
  return <div className="mt-4 text-sm"><p>导入成功 {report.success_count} · 失败 {report.failed_count}</p><ul className="mt-2 space-y-2">{report.results.map((item) => <li className="rounded-md bg-muted/50 p-2" key={item.line}><span className="font-medium">{item.product_name ?? `第 ${item.line} 行`}</span><span className="ml-2 text-muted-foreground">{item.status === "success" ? `Catalog：${item.catalog_product_id} · research v${item.research_version} · ${item.catalog_product_created ? "新建 Catalog" : "复用 Catalog"} · ${item.image_updated ? "图片已更新" : "图片未更新"}` : item.reason}</span></li>)}</ul></div>;
}
