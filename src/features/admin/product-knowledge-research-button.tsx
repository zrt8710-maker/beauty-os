"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProductKnowledgeResearchButton({
  catalogProductId,
  hasSnapshot,
}: {
  catalogProductId: string;
  hasSnapshot: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const label = hasSnapshot ? "重新研究" : "补充知识";

  async function research() {
    if (!window.confirm(`确定${label}吗？${hasSnapshot ? "当前研究版本会被保留，并创建新的 AI 研究版本。" : ""}`)) return;
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/knowledge/products/${catalogProductId}/research`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error?.message ?? "研究失败；当前版本未修改。");
        return;
      }
      if (result.status === "skipped") {
        setMessage("已有研究任务正在运行，请稍后刷新。");
        return;
      }
      setMessage("已创建新的 AI 研究版本。");
      router.refresh();
    } catch {
      setMessage("研究请求失败；当前版本未修改。");
    } finally {
      setRunning(false);
    }
  }

  return <div className="space-y-2">
    {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    <button className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60" disabled={running} onClick={() => void research()} type="button">
      {running ? "研究中…" : label}
    </button>
  </div>;
}
