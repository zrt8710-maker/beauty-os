"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CatalogProductImageMaintenance({
  catalogProductId,
  initialImageUrl,
}: {
  catalogProductId: string;
  initialImageUrl: string | null;
}) {
  const router = useRouter();
  const [imageUrl, setImageUrl] = useState(initialImageUrl ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const displayedImageUrl = imageUrl.trim() || null;

  async function save(remove = false) {
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/v1/admin/knowledge/products/${catalogProductId}/image`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalog_image_url: remove ? null : displayedImageUrl }),
    });
    const result: unknown = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(result && typeof result === "object" && "error" in result ? String((result as { error?: { message?: unknown } }).error?.message ?? "保存失败。") : "保存失败。");
      return;
    }
    if (remove) setImageUrl("");
    setFailed(false);
    setEditing(false);
    setMessage(remove ? "已移除产品图片。" : "已保存产品图片。");
    router.refresh();
  }

  return (
    <div className="mt-6 border-t pt-5">
      <p className="text-sm font-medium text-muted-foreground">产品图片</p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div aria-label={displayedImageUrl && !failed ? "Catalog 产品图片" : "产品图片占位符"} className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted text-center text-xs text-muted-foreground" role="img">
          {displayedImageUrl && !failed ? <img alt="Catalog 产品图片" className="h-full w-full object-cover" onError={() => setFailed(true)} src={displayedImageUrl} /> : "产品图片占位符"}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {editing ? <>
            <label className="block space-y-2 text-sm"><span>图片 URL（HTTPS）</span><input className="w-full rounded-lg border bg-background px-3 py-2" onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" value={imageUrl} /></label>
          </> : !displayedImageUrl ? <p className="text-sm text-muted-foreground">尚未维护产品图片。</p> : null}
          <div className="flex flex-wrap gap-2"><button className="rounded-lg border px-3 py-2 text-sm" disabled={saving} onClick={() => editing ? void save() : setEditing(true)} type="button">{saving ? "保存中…" : editing ? "保存图片" : "更换图片"}</button><button className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60" disabled={saving || !displayedImageUrl} onClick={() => void save(true)} type="button">移除图片</button></div>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}
