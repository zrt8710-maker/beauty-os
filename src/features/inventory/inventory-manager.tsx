"use client";

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  EDITABLE_OWNED_PRODUCT_STATUSES,
  PRODUCT_CATEGORIES,
  PRODUCT_TYPE_META,
  ownedProductSchema,
  productSchema,
  type OwnedProduct,
  type Product,
  type ProductCategory,
  type ProductType,
} from "@/schemas/product";
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

const statusLabels: Record<
  (typeof EDITABLE_OWNED_PRODUCT_STATUSES)[number],
  string
> = {
  unopened: "未开封",
  active: "使用中",
  paused: "暂停使用",
  finished: "已用完",
  discarded: "已弃用",
};

type InventoryManagerProps = {
  initialProducts: Product[];
  initialInventory: OwnedProduct[];
  initialUploads: UploadAsset[];
};

type NewProductDraft = {
  brand_name: string;
  product_name: string;
  category: ProductCategory;
  product_type: ProductType;
  status: (typeof EDITABLE_OWNED_PRODUCT_STATUSES)[number];
  purchase_date: string;
  opened_at: string;
  expires_on: string;
  quantity_remaining_percent: number;
  notes: string;
};

const initialDraft: NewProductDraft = {
  brand_name: "",
  product_name: "",
  category: "skincare",
  product_type: "cleanser",
  status: "unopened",
  purchase_date: "",
  opened_at: "",
  expires_on: "",
  quantity_remaining_percent: 100,
  notes: "",
};

export function InventoryManager({
  initialProducts,
  initialInventory,
  initialUploads,
}: InventoryManagerProps) {
  const [products, setProducts] = useState(initialProducts);
  const [inventory, setInventory] = useState(initialInventory);
  const [uploads, setUploads] = useState(initialUploads);
  const [draft, setDraft] = useState<NewProductDraft>(initialDraft);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  const availableTypes = useMemo(
    () =>
      (Object.entries(PRODUCT_TYPE_META) as Array<
        [ProductType, (typeof PRODUCT_TYPE_META)[ProductType]]
      >).filter(([, metadata]) => metadata.category === draft.category),
    [draft.category],
  );

  function changeCategory(category: ProductCategory) {
    const firstType = (Object.entries(PRODUCT_TYPE_META) as Array<
      [ProductType, (typeof PRODUCT_TYPE_META)[ProductType]]
    >).find(([, metadata]) => metadata.category === category)?.[0];

    if (!firstType) {
      return;
    }

    setDraft((current) => ({
      ...current,
      category,
      product_type: firstType,
    }));
    setPendingProduct(null);
  }

  async function addInventoryItem() {
    setIsSaving(true);
    setMessage("");
    setHasError(false);

    try {
      let product = pendingProduct;

      if (!product) {
        const response = await fetch("/api/v1/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand_name: draft.brand_name.trim() || null,
            product_name: draft.product_name.trim(),
            category: draft.category,
            product_type: draft.product_type,
          }),
        });
        const result: unknown = await response.json();
        product = parseData(result, productSchema);

        if (!response.ok || !product) {
          throw new Error("PRODUCT_CREATE_FAILED");
        }

        setPendingProduct(product);
        setProducts((current) =>
          current.some((item) => item.id === product?.id)
            ? current
            : [product as Product, ...current],
        );
      }

      const response = await fetch("/api/v1/owned-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: product.id,
          status: draft.status,
          purchase_date: draft.purchase_date || null,
          opened_at: draft.opened_at || null,
          expires_on: draft.expires_on || null,
          quantity_remaining_percent: draft.quantity_remaining_percent,
          notes: draft.notes.trim() || null,
        }),
      });
      const result: unknown = await response.json();
      const ownedProduct = parseData(result, ownedProductSchema);

      if (!response.ok || !ownedProduct) {
        throw new Error("OWNED_PRODUCT_CREATE_FAILED");
      }

      setInventory((current) => [ownedProduct, ...current]);
      setDraft(initialDraft);
      setPendingProduct(null);
      setMessage("产品已添加到资产库。");
    } catch (error) {
      setHasError(true);
      setMessage(
        error instanceof Error && error.message === "OWNED_PRODUCT_CREATE_FAILED"
          ? "产品基础记录已保存，但库存添加失败；再次提交会继续完成库存添加。"
          : "添加失败，请检查填写内容后重试。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function replaceOwnedProduct(saved: OwnedProduct) {
    setInventory((current) =>
      current.map((item) => (item.id === saved.id ? saved : item)),
    );
  }

  function removeOwnedProduct(id: string) {
    setInventory((current) => current.filter((item) => item.id !== id));
  }

  function addUpload(upload: UploadAsset) {
    setUploads((current) => [
      upload,
      ...current.filter((item) => item.id !== upload.id),
    ]);
  }

  function removeUpload(id: string) {
    setUploads((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">手动添加产品</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          先记录你已拥有的产品。本步骤不会调用 AI、识图或成分分析。
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="品牌（可选）">
            <input
              className={inputClassName}
              maxLength={120}
              onChange={(event) => {
                setDraft((current) => ({ ...current, brand_name: event.target.value }));
                setPendingProduct(null);
              }}
              placeholder="例如：CeraVe"
              value={draft.brand_name}
            />
          </Field>
          <Field label="产品名称">
            <input
              className={inputClassName}
              maxLength={200}
              onChange={(event) => {
                setDraft((current) => ({ ...current, product_name: event.target.value }));
                setPendingProduct(null);
              }}
              placeholder="例如：保湿洁面乳"
              value={draft.product_name}
            />
          </Field>
          <Field label="产品大类">
            <select
              className={inputClassName}
              onChange={(event) => changeCategory(event.target.value as ProductCategory)}
              value={draft.category}
            >
              {PRODUCT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {categoryLabels[category]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="具体类型">
            <select
              className={inputClassName}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  product_type: event.target.value as ProductType,
                }));
                setPendingProduct(null);
              }}
              value={draft.product_type}
            >
              {availableTypes.map(([type, metadata]) => (
                <option key={type} value={type}>
                  {metadata.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="使用状态">
            <select
              className={inputClassName}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as NewProductDraft["status"],
                }))
              }
              value={draft.status}
            >
              {EDITABLE_OWNED_PRODUCT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`剩余量：${draft.quantity_remaining_percent}%`}>
            <input
              className="h-11 w-full accent-primary"
              max={100}
              min={0}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  quantity_remaining_percent: Number(event.target.value),
                }))
              }
              type="range"
              value={draft.quantity_remaining_percent}
            />
          </Field>
          <Field label="购买日期（可选）">
            <input
              className={inputClassName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, purchase_date: event.target.value }))
              }
              type="date"
              value={draft.purchase_date}
            />
          </Field>
          <Field label="开封日期（可选）">
            <input
              className={inputClassName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, opened_at: event.target.value }))
              }
              type="date"
              value={draft.opened_at}
            />
          </Field>
          <Field label="明确到期日（可选）">
            <input
              className={inputClassName}
              onChange={(event) =>
                setDraft((current) => ({ ...current, expires_on: event.target.value }))
              }
              type="date"
              value={draft.expires_on}
            />
          </Field>
        </div>
        <Field className="mt-5" label="备注（可选）">
          <textarea
            className="min-h-24 w-full rounded-lg border bg-background px-3 py-2 font-normal"
            maxLength={2000}
            onChange={(event) =>
              setDraft((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder="例如：晚间使用；避免眼周"
            value={draft.notes}
          />
        </Field>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            aria-live="polite"
            className={hasError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
          >
            {message || `当前有 ${products.length} 条个人产品基础记录。`}
          </p>
          <Button
            className="h-10 px-5"
            disabled={isSaving || !draft.product_name.trim()}
            onClick={addInventoryItem}
            type="button"
          >
            {isSaving ? "正在添加…" : "添加到资产库"}
          </Button>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold">我的产品</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {inventory.length} 件未归档资产
            </p>
          </div>
        </div>

        {inventory.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-background p-10 text-center text-sm text-muted-foreground">
            资产库还是空的，从上方手动添加第一件产品。
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {inventory.map((ownedProduct) => (
              <InventoryItem
                key={ownedProduct.id}
                onArchive={removeOwnedProduct}
                onSaved={replaceOwnedProduct}
                onUploadAdded={addUpload}
                onUploadDeleted={removeUpload}
                ownedProduct={ownedProduct}
                uploads={uploads.filter(
                  (upload) => upload.product_id === ownedProduct.product_id,
                )}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InventoryItem({
  ownedProduct,
  onSaved,
  onArchive,
  uploads,
  onUploadAdded,
  onUploadDeleted,
}: {
  ownedProduct: OwnedProduct;
  onSaved: (saved: OwnedProduct) => void;
  onArchive: (id: string) => void;
  uploads: UploadAsset[];
  onUploadAdded: (upload: UploadAsset) => void;
  onUploadDeleted: (id: string) => void;
}) {
  const [status, setStatus] = useState<NewProductDraft["status"]>(
    ownedProduct.status === "archived" ? "paused" : ownedProduct.status,
  );
  const [quantity, setQuantity] = useState(ownedProduct.quantity_remaining_percent);
  const [purchaseDate, setPurchaseDate] = useState(ownedProduct.purchase_date ?? "");
  const [openedAt, setOpenedAt] = useState(ownedProduct.opened_at ?? "");
  const [expiresOn, setExpiresOn] = useState(ownedProduct.expires_on ?? "");
  const [notes, setNotes] = useState(ownedProduct.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/v1/owned-products/${ownedProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          purchase_date: purchaseDate || null,
          opened_at: openedAt || null,
          expires_on: expiresOn || null,
          quantity_remaining_percent: quantity,
          notes: notes.trim() || null,
        }),
      });
      const result: unknown = await response.json();
      const saved = parseData(result, ownedProductSchema);

      if (!response.ok || !saved) {
        throw new Error("SAVE_FAILED");
      }

      onSaved(saved);
      setMessage("已保存");
    } catch {
      setMessage("保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function archive() {
    if (!window.confirm("归档后将从当前资产列表隐藏，确认继续吗？")) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch(`/api/v1/owned-products/${ownedProduct.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("ARCHIVE_FAILED");
      }

      onArchive(ownedProduct.id);
    } catch {
      setMessage("归档失败");
      setIsSaving(false);
    }
  }

  return (
    <article className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {categoryLabels[ownedProduct.product.category]} ·{" "}
            {PRODUCT_TYPE_META[ownedProduct.product.product_type].label}
          </p>
          <h3 className="mt-1 font-semibold">{ownedProduct.product.product_name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {ownedProduct.product.brand_name ?? "未填写品牌"}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
          {quantity}%
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="状态">
          <select
            className={inputClassName}
            onChange={(event) => setStatus(event.target.value as NewProductDraft["status"])}
            value={status}
          >
            {EDITABLE_OWNED_PRODUCT_STATUSES.map((item) => (
              <option key={item} value={item}>
                {statusLabels[item]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`剩余量：${quantity}%`}>
          <input
            className="h-11 w-full accent-primary"
            max={100}
            min={0}
            onChange={(event) => setQuantity(Number(event.target.value))}
            type="range"
            value={quantity}
          />
        </Field>
        <Field label="购买日期">
          <input
            className={inputClassName}
            onChange={(event) => setPurchaseDate(event.target.value)}
            type="date"
            value={purchaseDate}
          />
        </Field>
        <Field label="开封日期">
          <input
            className={inputClassName}
            onChange={(event) => setOpenedAt(event.target.value)}
            type="date"
            value={openedAt}
          />
        </Field>
        <Field label="明确到期日">
          <input
            className={inputClassName}
            onChange={(event) => setExpiresOn(event.target.value)}
            type="date"
            value={expiresOn}
          />
        </Field>
      </div>
      <Field className="mt-4" label="备注">
        <textarea
          className="min-h-20 w-full rounded-lg border bg-background px-3 py-2 font-normal"
          maxLength={2000}
          onChange={(event) => setNotes(event.target.value)}
          value={notes}
        />
      </Field>

      <ProductImageUploader
        onUploadAdded={onUploadAdded}
        onUploadDeleted={onUploadDeleted}
        productId={ownedProduct.product_id}
        uploads={uploads}
      />

      <div className="mt-4 flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {message}
        </p>
        <div className="flex gap-2">
          <Button disabled={isSaving} onClick={archive} type="button" variant="destructive">
            归档
          </Button>
          <Button disabled={isSaving} onClick={save} type="button">
            {isSaving ? "处理中…" : "保存"}
          </Button>
        </div>
      </div>
    </article>
  );
}

function ProductImageUploader({
  productId,
  uploads,
  onUploadAdded,
  onUploadDeleted,
}: {
  productId: string;
  uploads: UploadAsset[];
  onUploadAdded: (upload: UploadAsset) => void;
  onUploadDeleted: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function selectFile(file: File | undefined) {
    if (!file) {
      return;
    }

    if (
      !PRODUCT_IMAGE_MIME_TYPES.includes(
        file.type as (typeof PRODUCT_IMAGE_MIME_TYPES)[number],
      )
    ) {
      setStatus("error");
      setMessage("仅支持 JPEG、PNG 或 WebP 图片。");
      resetInput();
      return;
    }

    if (file.size < 1 || file.size > MAX_PRODUCT_IMAGE_BYTES) {
      setStatus("error");
      setMessage("图片大小必须在 1 字节到 5 MB 之间。");
      resetInput();
      return;
    }

    setStatus("uploading");
    setMessage("正在创建安全上传任务…");
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
          product_id: productId,
        }),
      });
      const taskResult: unknown = await taskResponse.json();
      const task = parseData(taskResult, uploadTaskSchema);

      if (!taskResponse.ok || !task) {
        throw new Error("UPLOAD_TASK_FAILED");
      }

      uploadId = task.asset.id;
      setMessage("正在上传到私有存储…");
      const supabase = createBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .uploadToSignedUrl(
          task.signed_upload.path,
          task.signed_upload.token,
          file,
          { contentType: file.type, upsert: false },
        );

      if (uploadError) {
        throw new Error("STORAGE_UPLOAD_FAILED");
      }

      setMessage("正在确认上传结果…");
      const completeResponse = await fetch(
        `/api/v1/uploads/${task.asset.id}/complete`,
        { method: "POST" },
      );
      const completeResult: unknown = await completeResponse.json();
      const completed = parseData(completeResult, uploadAssetSchema);

      if (!completeResponse.ok || !completed) {
        throw new Error("UPLOAD_COMPLETE_FAILED");
      }

      onUploadAdded(completed);
      setStatus("success");
      setMessage("图片已安全上传。");
    } catch {
      if (uploadId) {
        await fetch(`/api/v1/uploads/${uploadId}`, { method: "DELETE" });
      }
      setStatus("error");
      setMessage("图片上传失败，请重新选择文件。");
    } finally {
      resetInput();
    }
  }

  async function deleteUpload(id: string) {
    const response = await fetch(`/api/v1/uploads/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setStatus("error");
      setMessage("图片删除失败，请稍后重试。");
      return;
    }

    onUploadDeleted(id);
    setStatus("success");
    setMessage("图片已删除。");
  }

  function resetInput() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <section className="mt-5 rounded-xl border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-medium">产品图片</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            JPEG、PNG 或 WebP，最大 5 MB；文件保存在 private bucket。
          </p>
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
          {status === "uploading" ? "上传中…" : "选择图片"}
          <input
            accept={PRODUCT_IMAGE_MIME_TYPES.join(",")}
            className="sr-only"
            disabled={status === "uploading"}
            onChange={(event) => selectFile(event.target.files?.[0])}
            ref={inputRef}
            type="file"
          />
        </label>
      </div>

      {uploads.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {uploads.map((upload) => (
            <li
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs"
              key={upload.id}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{upload.file_name}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {upload.status === "ready" ? "已上传" : upload.status}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {upload.signed_url ? (
                  <a
                    className="text-primary underline-offset-4 hover:underline"
                    href={upload.signed_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    临时查看
                  </a>
                ) : null}
                <button
                  className="text-destructive hover:underline"
                  onClick={() => deleteUpload(upload.id)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <p
        aria-live="polite"
        className={
          status === "error"
            ? "mt-3 text-xs text-destructive"
            : "mt-3 text-xs text-muted-foreground"
        }
      >
        {message}
      </p>
    </section>
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
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return null;
  }

  const result = schema.safeParse(value.data);
  return result.success && result.data ? result.data : null;
}

const inputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 font-normal outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
