"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_TYPE_META,
  type ProductCategory,
  type ProductType,
} from "@/schemas/product";
import {
  productDraftMatchResultSchema,
  productDraftSchema,
  type ProductDraft,
} from "@/schemas/product-draft";
import { catalogProductSchema, type CatalogProduct } from "@/schemas/knowledge";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MIME_TYPES,
  uploadAssetSchema,
  uploadTaskSchema,
  type UploadAsset,
} from "@/schemas/upload";

const categoryLabels: Record<ProductCategory, string> = {
  skincare: "护肤",
  makeup: "彩妆",
  bodycare: "身体护理",
  haircare: "头发护理",
  fragrance: "香氛",
  beauty_tool: "美妆工具",
  other: "其他",
};

export function ProductDraftsManager({
  initialDrafts,
  initialUploads,
  initialCandidates,
}: {
  initialDrafts: ProductDraft[];
  initialUploads: UploadAsset[];
  initialCandidates: Record<string, CatalogProduct>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [uploads, setUploads] = useState(initialUploads);
  const [isUploading, setIsUploading] = useState(false);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [candidates, setCandidates] = useState<Record<string, CatalogProduct>>(initialCandidates);

  async function uploadAndCreateDraft(file: File | undefined) {
    if (!file) return;

    if (
      !PRODUCT_IMAGE_MIME_TYPES.includes(
        file.type as (typeof PRODUCT_IMAGE_MIME_TYPES)[number],
      )
    ) {
      showError("仅支持 JPEG、PNG 或 WebP 图片。");
      resetFileInput();
      return;
    }

    if (file.size < 1 || file.size > MAX_PRODUCT_IMAGE_BYTES) {
      showError("图片大小必须在 1 字节到 5 MB 之间。");
      resetFileInput();
      return;
    }

    setIsUploading(true);
    setHasError(false);
    setMessage("正在上传图片…");
    let uploadId: string | null = null;

    try {
      const taskResponse = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          purpose: "product_image",
          product_id: null,
        }),
      });
      const task = parseData(await taskResponse.json(), uploadTaskSchema);

      if (!taskResponse.ok || !task) throw new Error("UPLOAD_TASK_FAILED");
      uploadId = task.asset.id;

      const supabase = createBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .uploadToSignedUrl(
          task.signed_upload.path,
          task.signed_upload.token,
          file,
          { contentType: file.type, upsert: false },
        );

      if (uploadError) throw new Error("STORAGE_UPLOAD_FAILED");

      const completeResponse = await fetch(
        `/api/v1/uploads/${task.asset.id}/complete`,
        { method: "POST" },
      );
      const upload = parseData(await completeResponse.json(), uploadAssetSchema);

      if (!completeResponse.ok || !upload) {
        throw new Error("UPLOAD_COMPLETE_FAILED");
      }

      const draftResponse = await fetch("/api/v1/product-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_asset_id: upload.id }),
      });
      const draft = parseData(await draftResponse.json(), productDraftSchema);

      if (!draftResponse.ok || !draft) throw new Error("DRAFT_CREATE_FAILED");

      setUploads((current) => [
        upload,
        ...current.filter((item) => item.id !== upload.id),
      ]);
      setDrafts((current) => [draft, ...current]);
      setMessage("草稿已创建，请填写并确认产品信息。");
    } catch {
      if (uploadId) {
        await fetch(`/api/v1/uploads/${uploadId}`, { method: "DELETE" });
      }
      showError("创建草稿失败，请重新选择图片。");
    } finally {
      setIsUploading(false);
      resetFileInput();
    }
  }

  function updateLocalDraft(id: string, update: Partial<ProductDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...update } : draft)),
    );
  }

  async function saveDraft(draft: ProductDraft) {
    const response = await fetch(`/api/v1/product-drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_name: draft.brand_name,
        product_name: draft.product_name,
        category: draft.category,
        subcategory: draft.subcategory,
        product_type: draft.product_type,
        notes: draft.notes,
        barcode: draft.barcode,
      }),
    });
    const saved = parseData(await response.json(), productDraftSchema);

    if (!response.ok || !saved) throw new Error("DRAFT_SAVE_FAILED");
    updateLocalDraft(saved.id, saved);
    return saved;
  }

  async function saveOnly(draft: ProductDraft) {
    setBusyDraftId(draft.id);
    setHasError(false);
    setMessage("");

    try {
      await saveDraft(draft);
      setMessage("草稿已保存。");
    } catch {
      showError("草稿保存失败，请检查填写内容。");
    } finally {
      setBusyDraftId(null);
    }
  }

  async function confirmDraft(draft: ProductDraft, confirmation: "link_candidate" | "manual") {
    setBusyDraftId(draft.id);
    setHasError(false);
    setMessage("");

    try {
      await saveDraft(draft);
      const response = await fetch(
        `/api/v1/product-drafts/${draft.id}/confirm`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) },
      );

      if (!response.ok) throw new Error("DRAFT_CONFIRM_FAILED");
      router.replace("/inventory");
      router.refresh();
    } catch {
      showError("确认失败。请填写名称与有效分类后重试；不会生成半成品资产。");
      setBusyDraftId(null);
    }
  }

  async function matchDraft(draft: ProductDraft) {
    setBusyDraftId(draft.id); setHasError(false); setMessage("");
    try {
      await saveDraft(draft);
      const response = await fetch(`/api/v1/product-drafts/${draft.id}/match`, { method: "POST" });
      const matchResult = parseData(
        await response.json(),
        productDraftMatchResultSchema,
      );
      if (!response.ok || !matchResult) throw new Error("MATCH_FAILED");
      const matched = matchResult.draft;
      updateLocalDraft(draft.id, matched);
      if (matchResult.status === "match_conflict") {
        setCandidates((current) => {
          const next = { ...current };
          delete next[draft.id];
          return next;
        });
        setMessage("找到多个同名目录产品，无法唯一匹配；请补充条码或保持手工产品。");
      } else if (matched.candidate_catalog_product_id) {
        const detailResponse = await fetch(`/api/v1/knowledge/products/${matched.candidate_catalog_product_id}/ingredients`);
        const payload: unknown = await detailResponse.json();
        if (detailResponse.ok && typeof payload === "object" && payload !== null && "data" in payload && typeof payload.data === "object" && payload.data !== null && "product" in payload.data) {
          const candidate = catalogProductSchema.safeParse(payload.data.product);
          if (candidate.success) setCandidates((current) => ({ ...current, [draft.id]: candidate.data }));
        }
        setMessage("找到目录候选，请明确选择是否关联。");
      } else {
        setCandidates((current) => {
          const next = { ...current };
          delete next[draft.id];
          return next;
        });
        setMessage("未找到已验证目录候选；你仍可保持手工产品。");
      }
    } catch { showError("候选匹配失败，请检查草稿信息后重试。"); } finally { setBusyDraftId(null); }
  }

  async function rejectDraft(id: string) {
    setBusyDraftId(id);
    const response = await fetch(`/api/v1/product-drafts/${id}`, {
      method: "DELETE",
    });

    if (response.ok) {
      setDrafts((current) => current.filter((draft) => draft.id !== id));
      setMessage("草稿已移除，原图片资产仍保留。");
      setHasError(false);
    } else {
      showError("草稿移除失败。");
    }

    setBusyDraftId(null);
  }

  function showError(value: string) {
    setHasError(true);
    setMessage(value);
  }

  function resetFileInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">添加产品草稿</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              上传一张辅助图片，然后由你人工填写产品信息。最大 5 MB。
            </p>
          </div>
          <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
            {isUploading ? "上传并创建中…" : "选择产品图片"}
            <input
              accept={PRODUCT_IMAGE_MIME_TYPES.join(",")}
              className="sr-only"
              disabled={isUploading}
              onChange={(event) => uploadAndCreateDraft(event.target.files?.[0])}
              ref={inputRef}
              type="file"
            />
          </label>
        </div>
      </section>

      <p
        aria-live="polite"
        className={hasError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
      >
        {message}
      </p>

      {drafts.length === 0 ? (
        <section className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
          暂无待确认草稿。
        </section>
      ) : (
        <div className="space-y-6">
          {drafts.map((draft) => (
            <DraftEditor
              draft={draft}
              image={uploads.find((asset) => asset.id === draft.upload_asset_id)}
              isBusy={busyDraftId === draft.id}
              key={draft.id}
              onChange={(update) => updateLocalDraft(draft.id, update)}
              candidate={candidates[draft.id]}
              onConfirm={(confirmation) => confirmDraft(draft, confirmation)}
              onMatch={() => matchDraft(draft)}
              onReject={() => rejectDraft(draft.id)}
              onSave={() => saveOnly(draft)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftEditor({
  draft,
  image,
  isBusy,
  onChange,
  onSave,
  onMatch,
  onConfirm,
  onReject,
  candidate,
}: {
  draft: ProductDraft;
  image: UploadAsset | undefined;
  isBusy: boolean;
  onChange: (update: Partial<ProductDraft>) => void;
  onSave: () => void;
  onConfirm: (confirmation: "link_candidate" | "manual") => void;
  onMatch: () => void;
  onReject: () => void;
  candidate: CatalogProduct | undefined;
}) {
  const availableTypes = useMemo(
    () =>
      (Object.entries(PRODUCT_TYPE_META) as Array<
        [ProductType, (typeof PRODUCT_TYPE_META)[ProductType]]
      >).filter(([, metadata]) => metadata.category === draft.category),
    [draft.category],
  );

  function changeCategory(nextCategory: ProductCategory) {
    const first = (Object.entries(PRODUCT_TYPE_META) as Array<
      [ProductType, (typeof PRODUCT_TYPE_META)[ProductType]]
    >).find(([, metadata]) => metadata.category === nextCategory);

    if (!first) return;
    onChange({
      category: nextCategory,
      subcategory: first[1].subcategory,
      product_type: first[0],
    });
  }

  function changeType(productType: ProductType) {
    const metadata = PRODUCT_TYPE_META[productType];
    onChange({
      category: metadata.category,
      subcategory: metadata.subcategory,
      product_type: productType,
    });
  }

  return (
    <article className="rounded-2xl border bg-card p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">待确认产品</h2>
          <p className="mt-1 text-xs text-muted-foreground">来源：人工录入</p>
        </div>
        {image?.signed_url ? (
          <a
            className="text-sm text-primary underline-offset-4 hover:underline"
            href={image.signed_url}
            rel="noreferrer"
            target="_blank"
          >
            查看临时图片
          </a>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="品牌（可选）">
          <input
            className={inputClassName}
            maxLength={120}
            onChange={(event) => onChange({ brand_name: event.target.value.trim() ? event.target.value : null })}
            placeholder="例如：CeraVe"
            value={draft.brand_name ?? ""}
          />
        </Field>
        <Field label="产品名称">
          <input
            className={inputClassName}
            maxLength={200}
            onChange={(event) => onChange({ product_name: event.target.value.trim() ? event.target.value : null })}
            placeholder="请按包装人工填写"
            value={draft.product_name ?? ""}
          />
        </Field>
        <Field label="条码（可选）">
          <input className={inputClassName} maxLength={32} onChange={(event) => onChange({ barcode: event.target.value.trim() ? event.target.value : null })} placeholder="用于精确目录匹配" value={draft.barcode ?? ""} />
        </Field>
        <Field label="产品大类">
          <select
            className={inputClassName}
            onChange={(event) => changeCategory(event.target.value as ProductCategory)}
            value={draft.category ?? ""}
          >
            <option disabled value="">请选择产品大类</option>
            {PRODUCT_CATEGORIES.map((item) => (
              <option key={item} value={item}>{categoryLabels[item]}</option>
            ))}
          </select>
        </Field>
        <Field label="具体类型">
          <select
            className={inputClassName}
            disabled={!draft.category}
            onChange={(event) => changeType(event.target.value as ProductType)}
            value={draft.product_type ?? ""}
          >
            <option disabled value="">请选择具体类型</option>
            {availableTypes.map(([type, metadata]) => (
              <option key={type} value={type}>{metadata.label}</option>
            ))}
          </select>
        </Field>
        <Field className="sm:col-span-2" label="备注（可选）">
          <textarea
            className={`${inputClassName} min-h-24 py-3`}
            maxLength={2000}
            onChange={(event) => onChange({ notes: event.target.value.trim() ? event.target.value : null })}
            placeholder="只记录你确认过的信息"
            value={draft.notes ?? ""}
          />
        </Field>
      </div>

      <section className="mt-5 rounded-xl border border-dashed p-4 text-sm">
        <p className="font-medium">目录候选（不会自动关联）</p>
        {candidate ? <div className="mt-2 text-muted-foreground"><p>{candidate.brand_name} · {candidate.product_name}</p><p>来源：{candidate.source.name} · 置信度 {draft.match_confidence}</p><p>依据：{draft.match_evidence}</p></div> : <p className="mt-2 text-muted-foreground">填写品牌与名称，或条码后可查询已验证目录候选。</p>}
        <Button className="mt-3" disabled={isBusy} onClick={onMatch} type="button" variant="outline">查询候选</Button>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button disabled={isBusy} onClick={onSave} type="button" variant="outline">
          保存草稿
        </Button>
        {candidate ? <Button disabled={isBusy} onClick={() => onConfirm("link_candidate")} type="button">关联此产品并保存</Button> : null}
        <Button disabled={isBusy} onClick={() => onConfirm("manual")} type="button">{isBusy ? "处理中…" : "保持手工产品并保存"}</Button>
        <Button disabled={isBusy} onClick={onReject} type="button" variant="ghost">
          移除草稿
        </Button>
      </div>
    </article>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block space-y-2 text-sm font-medium ${className ?? ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function parseData<T>(
  value: unknown,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
): T | null {
  if (typeof value !== "object" || value === null || !("data" in value)) return null;
  const result = schema.safeParse(value.data);
  return result.success && result.data ? result.data : null;
}

const inputClassName =
  "w-full rounded-lg border bg-background px-3 font-normal outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 h-11";
