"use client";

import { useRef, useState } from "react";

import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { Button } from "@/components/ui/button";
import { Dialog } from "@base-ui/react/dialog";
import {
  manualSearchToIdentityClue,
  recognitionCandidateToIdentityClue,
} from "@/domain/product-identity-clue";
import {
  buildIdentityPersistenceFields,
  catalogCandidatesUiTransition,
  catalogIdentityToLookupCandidate,
  canCreateUserAsset,
  candidateToInventoryAddSelection,
  DEFAULT_INVENTORY_ADD_STATUS,
  externalIdentityToLookupCandidate,
  identityResolutionContinuation,
  pendingAssetFallbackForResolution,
  recognitionToLookupResponse,
  resolveInventoryProductType,
  unknownIdentityResolution,
  type InventoryAddFlowStage,
  type InventoryAddIdentityResolution,
  type IdentityResolutionContinuation,
  type IdentityResolutionRequestContext,
  type UserProductLookupCandidate,
} from "@/features/inventory/inventory-add-flow";
import {
  ASSET_SECTION_META,
  ASSET_SECTIONS,
  filterInventoryBySection,
  getExpiryInformationHint,
  getOwnedProductImageUploads,
  getAssetSectionCounts,
  groupInventoryByBrand,
  groupInventoryBySection,
  preserveOwnedProductImagePresentation,
  synchronizeInventoryImagePresentation,
  suggestAssetCategory,
  type AssetSection,
} from "@/features/inventory/inventory-view-model";
import { QuantityQuickEditor } from "@/features/inventory/quantity-quick-editor";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  EDITABLE_OWNED_PRODUCT_STATUSES,
  PRODUCT_TYPE_META,
  ownedProductSchema,
  type OwnedProduct,
  type ProductType,
  type UserAssetCategory,
} from "@/schemas/product";
import {
  type UserProductLookupResponse,
} from "@/schemas/user-product-lookup";
import type { ProductIdentityClue } from "@/schemas/product-identity-clue";
import {
  productRecognitionResponseSchema,
  type ProductRecognitionCandidate,
} from "@/schemas/product-recognition";
import {
  productIdentityResolutionSchema,
  type ProductIdentityResolution,
} from "@/schemas/product-identity-resolution";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MIME_TYPES,
  uploadAssetSchema,
  uploadTaskSchema,
  type UploadAsset,
} from "@/schemas/upload";

const RECOGNITION_IMAGE_POSITIONS = ["front", "back", "bottom"] as const;

const INVENTORY_UI_STATUSES = [
  "active",
  "paused",
  "finished",
  "discarded",
] as const satisfies readonly (typeof EDITABLE_OWNED_PRODUCT_STATUSES)[number][];

type InventoryUiStatus = (typeof INVENTORY_UI_STATUSES)[number];

const statusLabels: Record<InventoryUiStatus, string> = {
  active: "使用中",
  paused: "暂停使用",
  finished: "已用完",
  discarded: "已弃用",
};

const archivedStatusLabel = "已移除";

type InventoryManagerProps = {
  initialInventory: OwnedProduct[];
  initialUploads: UploadAsset[];
};

type NewProductDraft = {
  brand_name: string;
  product_name: string;
  variant_name: string;
  barcode: string;
  product_type: ProductType | null;
  asset_category: UserAssetCategory;
  status: InventoryUiStatus;
  expires_on: string;
  quantity_remaining_percent: number;
  notes: string;
  package_size: string;
  manufacture_date: string;
};

type ProductLookupEntry = "choices" | "name";

const initialDraft: NewProductDraft = {
  brand_name: "",
  product_name: "",
  variant_name: "",
  barcode: "",
  product_type: null,
  asset_category: "other",
  status: "active",
  expires_on: "",
  quantity_remaining_percent: 100,
  notes: "",
  package_size: "",
  manufacture_date: "",
};

export function InventoryManager({
  initialInventory,
  initialUploads,
}: InventoryManagerProps) {
  const [inventory, setInventory] = useState(initialInventory);
  const [previousInitialInventory, setPreviousInitialInventory] = useState(initialInventory);
  const [uploads, setUploads] = useState(initialUploads);
  const [draft, setDraft] = useState<NewProductDraft>(initialDraft);
  const [lookupEntry, setLookupEntry] = useState<ProductLookupEntry>("choices");
  const recognitionImageInputRef = useRef<HTMLInputElement>(null);
  const addFlowIdempotencyKeyRef = useRef<string | null>(null);
  const [lookupResult, setLookupResult] =
    useState<UserProductLookupResponse | null>(null);
  const [recognitionCandidates, setRecognitionCandidates] =
    useState<ProductRecognitionCandidate[] | null>(null);
  const [identityContinuation, setIdentityContinuation] =
    useState<IdentityResolutionContinuation | null>(null);
  const [pendingAssetResolution, setPendingAssetResolution] =
    useState<InventoryAddIdentityResolution | null>(null);
  const [lookupMessage, setLookupMessage] = useState("");
  const [identityLoadingMessage, setIdentityLoadingMessage] = useState("");
  const [isMatching, setIsMatching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [addFlowStage, setAddFlowStage] =
    useState<InventoryAddFlowStage | null>(null);
  const [selectedOwnedProduct, setSelectedOwnedProduct] = useState<OwnedProduct | null>(
    null,
  );
  const [quantityEditorProduct, setQuantityEditorProduct] = useState<OwnedProduct | null>(
    null,
  );
  const [selectedAssetSection, setSelectedAssetSection] = useState<AssetSection | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [groupByBrand, setGroupByBrand] = useState(false);
  const [inventoryView, setInventoryView] = useState<"categories" | "expiring">(
    "categories",
  );

  // Adjust only refreshed image metadata; preserve local quantity/edit state.
  if (previousInitialInventory !== initialInventory) {
    setPreviousInitialInventory(initialInventory);
    setInventory((current) =>
      synchronizeInventoryImagePresentation(current, initialInventory),
    );
    setSelectedOwnedProduct((current) => {
      if (!current) return current;
      return synchronizeInventoryImagePresentation([current], initialInventory)[0] ?? current;
    });
  }

  function editIdentity(patch: Partial<Pick<
    NewProductDraft,
    "brand_name" | "product_name" | "barcode"
  >>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function resetAddFlow() {
    setDraft(initialDraft);
    setLookupEntry("choices");
    setLookupResult(null);
    setRecognitionCandidates(null);
    setIdentityContinuation(null);
    setPendingAssetResolution(null);
    setLookupMessage("");
    setIdentityLoadingMessage("");
    setIsMatching(false);
    addFlowIdempotencyKeyRef.current = null;
    setAddFlowStage(null);
  }

  function enterUnknownConfirmation(
    message: string,
    identityPatch: Partial<NewProductDraft> = {},
  ) {
    setDraft((current) => ({
      ...current,
      ...identityPatch,
      product_type: null,
    }));
    setLookupMessage(message);
    setIdentityContinuation(null);
    setAddFlowStage("unknown_confirmation");
  }

  async function chooseLookupCandidate(
    candidate: UserProductLookupCandidate,
    recognitionCandidate: ProductRecognitionCandidate | null = null,
  ) {
    if (recognitionCandidate) {
      await resolveRecognitionCandidate(recognitionCandidate);
      return;
    }

    const selection = candidateToInventoryAddSelection(candidate);
    const productType = resolveInventoryProductType(
      selection.identity,
      selection.productType,
    );
    const confirmedDraft: NewProductDraft = {
      ...draft,
      ...selection.identity,
      product_type: productType,
      asset_category: suggestAssetCategory({
        category: PRODUCT_TYPE_META[productType].category,
        product_type: productType,
      }),
    };
    setDraft(confirmedDraft);
    setPendingAssetResolution(selection.resolution);
    setAddFlowStage("asset_setup");
  }

  function confirmUnknownIdentity() {
    const identity = {
      brand_name: draft.brand_name,
      product_name: draft.product_name,
      variant_name: "",
      barcode: draft.barcode,
    };
    const productType = resolveInventoryProductType(identity, null);

    setPendingAssetResolution(unknownIdentityResolution());
    setDraft((current) => ({
      ...current,
      variant_name: "",
      product_type: productType,
      asset_category: suggestAssetCategory({
        category: PRODUCT_TYPE_META[productType].category,
        product_type: productType,
      }),
    }));
    setAddFlowStage("asset_setup");
  }

  async function resolveRecognitionCandidate(candidate: ProductRecognitionCandidate) {
    if (!candidate.recognition_reference) {
      setHasError(true);
      setMessage("识别结果已失效，请重新识别产品。");
      return;
    }

    await resolveIdentityClue(
      recognitionCandidateToIdentityClue(candidate),
      candidate.recognition_reference,
    );
  }

  async function resolveIdentityClue(
    clue: ProductIdentityClue,
    recognitionReference: string | null = null,
    declinedCatalogProductIds: string[] = [],
  ) {
    const isNameLookup = clue.source === "manual_search";
    const initialMessage = isNameLookup
      ? "正在查找产品…"
      : "正在确认产品信息…";
    const slowLookupTimer = isNameLookup
      ? window.setTimeout(
        () => setIdentityLoadingMessage("正在确认产品信息，可能需要一点时间…"),
        900,
      )
      : null;
    setIsMatching(true);
    setHasError(false);
    setIdentityContinuation(null);
    setIdentityLoadingMessage(initialMessage);
    setAddFlowStage("identity_resolving");
    try {
      const response = await fetch("/api/v1/product-identity/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity_clue: clue,
          recognition_reference: recognitionReference,
          declined_catalog_product_ids: declinedCatalogProductIds,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        reportIdentityResolutionFailure("http", { status: response.status });
        return;
      }
      if (typeof result !== "object" || result === null || !("data" in result)) {
        reportIdentityResolutionFailure("schema", { issue: "missing_data_envelope" });
        return;
      }
      const parsed = productIdentityResolutionSchema.safeParse(result.data);
      if (!parsed.success) {
        reportIdentityResolutionFailure("schema", {
          issues: parsed.error.issues.slice(0, 5).map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
          })),
        });
        return;
      }
      const originalRequest = { clue, recognitionReference };
      try {
        applyIdentityResolution(parsed.data, originalRequest);
      } catch (error) {
        reportIdentityResolutionFailure("programming", error);
      }
    } catch (error) {
      reportIdentityResolutionFailure("transport", error);
    } finally {
      if (slowLookupTimer !== null) window.clearTimeout(slowLookupTimer);
      setIdentityLoadingMessage("");
      setIsMatching(false);
    }
  }

  function applyIdentityResolution(
    resolution: ProductIdentityResolution,
    originalRequest: IdentityResolutionRequestContext,
  ) {
    setIdentityContinuation(identityResolutionContinuation(resolution, originalRequest));
    if (resolution.status === "matched") {
      setLookupMessage("找到产品，请确认是否加入我的资产。");
      setLookupResult({ lookup_status: "catalog_match", candidates: [catalogIdentityToLookupCandidate(resolution.product_identity)] });
      setRecognitionCandidates(null);
      setAddFlowStage("candidate_selection");
      return;
    }
    if (resolution.status === "catalog_candidates") {
      const transition = catalogCandidatesUiTransition(resolution);
      setLookupResult(transition.lookupResult);
      setRecognitionCandidates(null);
      setLookupMessage(transition.lookupMessage);
      setAddFlowStage(transition.stage);
      return;
    }
    if (resolution.status === "external_candidate") {
      setLookupResult({
        lookup_status: "external_candidate",
        candidates: resolution.candidates.map(externalIdentityToLookupCandidate),
      });
      setRecognitionCandidates(null);
      setLookupMessage("可能是以下公开产品，请确认包装信息是否一致。");
      setAddFlowStage("candidate_selection");
      return;
    }
    const fallback = pendingAssetFallbackForResolution(resolution);
    if (fallback) enterUnknownConfirmation(fallback.message, fallback.identityPatch);
  }

  function reportIdentityResolutionFailure(
    kind: "transport" | "http" | "schema" | "programming",
    detail: unknown,
  ) {
    if (process.env.NODE_ENV !== "production") {
      console.error("PRODUCT_IDENTITY_RESOLUTION_UI_FAILED", { kind, detail });
    }
    setIdentityContinuation(null);
    setHasError(true);
    setMessage("产品查找遇到异常，请重试。");
    setAddFlowStage("lookup");
  }

  async function rejectLookupCandidates() {
    if (identityContinuation?.nextAction === "show_resolved_external_candidates") {
      setLookupResult(identityContinuation.externalLookup);
      setRecognitionCandidates(null);
      setIdentityContinuation(null);
      setLookupMessage("未选择知识库产品，请确认公开搜索得到的产品身份。");
      setAddFlowStage("candidate_selection");
      return;
    }
    if (identityContinuation?.nextAction === "external_discovery") {
      await resolveIdentityClue(
        identityContinuation.originalRequest.clue,
        identityContinuation.originalRequest.recognitionReference,
        identityContinuation.declinedCatalogProductIds,
      );
      return;
    }
    enterUnknownConfirmation("这些候选都不符合，请确认包装上的产品信息。");
  }

  async function lookupProduct() {
    await resolveIdentityClue(manualSearchToIdentityClue({
      query: draft.product_name,
      brand_name: draft.brand_name || null,
    }));
  }

  async function recognizeProductImages(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []).slice(0, RECOGNITION_IMAGE_POSITIONS.length);
    if (selectedFiles.length === 0) return;

    if (selectedFiles.some((file) => !PRODUCT_IMAGE_MIME_TYPES.includes(
      file.type as (typeof PRODUCT_IMAGE_MIME_TYPES)[number],
    ) || file.size < 1 || file.size > MAX_PRODUCT_IMAGE_BYTES)) {
      setHasError(true);
      setMessage("请上传不超过 5 MB 的 JPEG、PNG 或 WebP 产品照片。");
      return;
    }

    setIsMatching(true);
    setHasError(false);
    setLookupMessage("");
    try {
      const imageDataUrls = await Promise.all(selectedFiles.map(readFileAsDataUrl));
      const response = await fetch("/api/v1/product-recognition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "image",
          images: imageDataUrls.map((data_url, index) => ({
            data_url,
            position: RECOGNITION_IMAGE_POSITIONS[index],
          })),
        }),
      });
      const result: unknown = await response.json();
      const recognition = parseData(result, productRecognitionResponseSchema);
      if (!response.ok || !recognition) throw new Error("RECOGNITION_FAILED");

      const lookup = recognitionToLookupResponse(recognition);
      setRecognitionCandidates(recognition.candidates);
      if (lookup.candidates.length > 0) {
        setLookupResult(lookup);
        setAddFlowStage("candidate_selection");
        setLookupMessage("请选择一条图片识别线索，继续查找实际产品。");
        return;
      }
      enterUnknownConfirmation(
        "暂未识别出产品信息，请补充包装上的品牌和产品名称。",
      );
    } catch {
      setHasError(true);
      setMessage("暂时无法识别这张产品照片，请稍后重试或使用产品名称搜索。");
    } finally {
      setIsMatching(false);
      if (recognitionImageInputRef.current) {
        recognitionImageInputRef.current.value = "";
      }
    }
  }

  async function addInventoryItem(
    assetDraft: NewProductDraft,
    resolution: InventoryAddIdentityResolution,
  ) {
    if (!canCreateUserAsset(addFlowStage, pendingAssetResolution)) {
      setHasError(true);
      setMessage("请先确认产品身份，再创建资产。");
      return;
    }
    if (!assetDraft.product_type) {
      setHasError(true);
      setMessage("请先完成产品身份确认。");
      return;
    }

    setIsSaving(true);
    setMessage("");
    setHasError(false);

    try {
      const idempotencyKey = resolution.resolutionKind === "external"
        ? resolution.confirmationId
        : (addFlowIdempotencyKeyRef.current ?? crypto.randomUUID());
      if (!idempotencyKey || (resolution.resolutionKind === "external" && !resolution.confirmationToken)) {
        throw new Error("EXTERNAL_CONFIRMATION_REQUIRED");
      }
      addFlowIdempotencyKeyRef.current = idempotencyKey;
      const response = await fetch("/api/v1/owned-products/with-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildIdentityPersistenceFields(assetDraft, resolution),
          asset_category: assetDraft.asset_category,
          category: PRODUCT_TYPE_META[assetDraft.product_type].category,
          product_type: assetDraft.product_type,
          purchase_date: null,
          manufacture_date: assetDraft.manufacture_date || null,
          expires_on: assetDraft.expires_on || null,
          quantity_remaining_percent: assetDraft.status === "finished" ? 0 : assetDraft.quantity_remaining_percent,
          notes: assetDraft.notes.trim() || null,
          package_size: assetDraft.package_size.trim() || null,
          status: assetDraft.status,
          confirmation_token: resolution.resolutionKind === "external"
            ? resolution.confirmationToken
            : null,
          idempotency_key: idempotencyKey,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const code = readApiErrorCode(result);
        throw new Error(code === "IDENTITY_CONFIRMATION_INVALID"
          ? "IDENTITY_CONFIRMATION_INVALID"
          : `SAVE_FAILED_${code ?? response.status}`);
      }
      const ownedProduct = parseData(result, ownedProductSchema);
      if (!ownedProduct) {
        throw new Error("SAVE_RESPONSE_INVALID");
      }

      setInventory((current) => [ownedProduct, ...current]);
      resetAddFlow();
      setSelectedOwnedProduct(ownedProduct);
      setMessage("已添加到我的产品");
    } catch (error) {
      setHasError(true);
      if (error instanceof Error && error.message === "IDENTITY_CONFIRMATION_INVALID") {
        setPendingAssetResolution(null);
        setAddFlowStage("lookup");
        setMessage("产品确认已失效，请重新搜索并确认后再保存。");
      } else if (error instanceof Error && error.message === "SAVE_RESPONSE_INVALID") {
        setMessage("服务器已接受保存，但页面未能读取结果；请刷新资产列表确认，避免重复添加。");
      } else {
        const code = error instanceof Error && error.message.startsWith("SAVE_FAILED_")
          ? error.message.slice("SAVE_FAILED_".length)
          : null;
        setMessage(`添加失败，请刷新页面确认是否已保存后重试。${code ? `错误代码：${code}` : ""}`);
      }
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
    if (upload.owned_product_id && upload.signed_url) {
      setInventory((current) => current.map((item) => item.id === upload.owned_product_id
        ? { ...item, image_override_upload_id: upload.id, image: { resolved_url: upload.signed_url, source: "user_override", has_override: true } }
        : item));
      setSelectedOwnedProduct((current) => current?.id === upload.owned_product_id
        ? { ...current, image_override_upload_id: upload.id, image: { resolved_url: upload.signed_url, source: "user_override", has_override: true } }
        : current);
    }
  }

  function removeUpload(id: string) {
    setUploads((current) => current.filter((item) => item.id !== id));
  }

  const currentInventory = inventory.filter(
    (item) => !["finished", "discarded", "archived"].includes(item.status),
  );
  const summary = {
    current: currentInventory.length,
    expiringSoon: currentInventory.filter((item) => isExpiringSoon(item.expires_on)).length,
  };
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchingInventory = inventory.filter((item) =>
    `${item.product.product_name} ${item.product.brand_name ?? ""}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const sectionCounts = getAssetSectionCounts(matchingInventory);
  const visibleAssetSections = selectedAssetSection
    ? [selectedAssetSection]
    : ASSET_SECTIONS;
  const expiringInventory = matchingInventory.filter((item) => currentInventory.includes(item) && isExpiringSoon(item.expires_on));
  const expiringInventoryBySection = groupInventoryBySection(expiringInventory);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="beauty-page-title">我的美妆资产</h1>
          <p className="beauty-copy mt-3">
            按品类和品牌查看已经拥有的产品、余量与到期状态。
          </p>
        </div>
        <Button
          className="w-full px-5 sm:w-auto"
          onClick={() => {
            resetAddFlow();
            setAddFlowStage("lookup");
          }}
          type="button"
        >
          <BeautyNavIcon name="add-product" size={20} />
          添加我的产品
        </Button>
      </section>

      <section
        aria-label="资产概览"
        className="beauty-collection-bar text-sm"
      >
        <span className="font-medium">{summary.current} 件产品</span>
        <span aria-hidden="true" className="text-border">·</span>
        <button
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setSelectedAssetSection(null);
            setInventoryView("expiring");
          }}
          type="button"
        >
          {summary.expiringSoon} 件将在 30 天内到期
        </button>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 sm:ml-auto">
          <input checked={groupByBrand} className="accent-primary" onChange={(event) => setGroupByBrand(event.target.checked)} type="checkbox" />
          按品牌分组
        </label>
      </section>

      <label className="block">
        <span className="sr-only">搜索我的产品或品牌</span>
        <input className="beauty-field" onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索产品或品牌…" type="search" value={searchQuery} />
      </label>
      {normalizedQuery ? <p aria-live="polite" className="beauty-meta">找到 {matchingInventory.length} 件产品</p> : null}
      <section>
        {inventoryView === "expiring" ? (
          <>
            <div className="mb-6">
              <button
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setInventoryView("categories")}
                type="button"
              >
                <span className="inline-flex items-center gap-1.5"><BeautyNavIcon name="back" size={16} />全部资产</span>
              </button>
              <h2 className="mt-2 text-xl font-semibold">
                30 天内到期 <span className="font-normal text-muted-foreground">· {expiringInventory.length} 件</span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                基于你填写的明确到期日，仅展示未来 30 天内到期的当前持有产品。
              </p>
            </div>

            {expiringInventory.length === 0 ? (
              <div className="beauty-empty">
                <BeautyNavIcon className="mx-auto mb-3 text-muted-foreground" name="inventory" size={24} />
                <p>暂时没有未来 30 天内到期的产品。</p>
              </div>
            ) : (
              <div className="space-y-8">
                {ASSET_SECTIONS.map((section) => {
                  const products = expiringInventoryBySection[section];
                  return (
                    <section key={section}>
                      <div className="mb-4 flex items-baseline justify-between gap-3">
                        <h3 className="text-lg font-semibold">
                          {ASSET_SECTION_META[section].label}
                        </h3>
                        <p className="text-sm text-muted-foreground">{products.length} 件</p>
                      </div>
                      {products.length === 0 ? (
                        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                          这个分类没有即将到期的产品。
                        </p>
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {products.map((ownedProduct) => (
                            <InventoryCard
                              key={ownedProduct.id}
                              onOpen={() => setSelectedOwnedProduct(ownedProduct)}
                              ownedProduct={ownedProduct}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div
              aria-label="资产分类筛选"
              className="mb-6 flex flex-wrap gap-2"
              role="group"
            >
              <button
                aria-pressed={selectedAssetSection === null}
                className={inventoryFilterClassName(selectedAssetSection === null)}
                onClick={() => setSelectedAssetSection(null)}
                type="button"
              >
                <span>全部</span>
                <span className="text-xs text-muted-foreground">{matchingInventory.length}</span>
              </button>
              {ASSET_SECTIONS.map((section) => (
                <button
                  aria-pressed={selectedAssetSection === section}
                  className={inventoryFilterClassName(selectedAssetSection === section)}
                  key={section}
                  onClick={() => setSelectedAssetSection(section)}
                  type="button"
                >
                  <span>{ASSET_SECTION_META[section].label}</span>
                  <span className="text-xs text-muted-foreground">{sectionCounts[section]}</span>
                </button>
              ))}
            </div>

            {inventory.length > 0 && matchingInventory.length === 0 ? (
              <div className="beauty-empty"><p>没有找到匹配的产品，试试其他名称或品牌。</p><Button className="mt-3" onClick={() => setSearchQuery("")} variant="outline">清除搜索</Button></div>
            ) : inventory.length === 0 ? (
              <div className="beauty-empty">
                <BeautyNavIcon className="mx-auto mb-3 text-muted-foreground" name="inventory" size={24} />
                <p>还没有产品，可以先添加一件产品。</p>
                <Button className="mt-4" onClick={() => { resetAddFlow(); setAddFlowStage("lookup"); }} type="button" variant="outline">添加第一件产品</Button>
              </div>
            ) : (
              <div className="space-y-7 sm:space-y-8">
                {visibleAssetSections.map((section) => {
                  const products = filterInventoryBySection(matchingInventory, section);
                  if (!products.length && !selectedAssetSection) return null;
                  return (
                    <InventoryCategorySection
                      groupByBrand={groupByBrand}
                      key={section}
                      onOpen={setSelectedOwnedProduct}
                      onQuickQuantity={setQuantityEditorProduct}
                      products={products}
                      section={section}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <p
        aria-live="polite"
        className={hasError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
      >
        {message}
      </p>

      <Modal
        description="提供产品线索，Beauty OS 将帮助识别这件产品。"
        onClose={resetAddFlow}
        open={addFlowStage !== null}
        title="添加我的产品"
      >
        {addFlowStage === "lookup" ? (
          <>
            {lookupEntry === "choices" ? (
              <section className="space-y-4">
                <div className="rounded-2xl border bg-muted/30 p-5">
                  <p className="text-base font-semibold">拍照识别</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    尽量拍清品牌和产品名称，完整正面包装更容易识别。
                  </p>
                  <input
                    accept={PRODUCT_IMAGE_MIME_TYPES.join(",")}
                    className="sr-only"
                    multiple
                    onChange={(event) => void recognizeProductImages(event.target.files)}
                    ref={recognitionImageInputRef}
                    type="file"
                  />
                  <Button
                    className="mt-4"
                    disabled={isMatching}
                    onClick={() => recognitionImageInputRef.current?.click()}
                    type="button"
                  >
                    {isMatching ? "正在读取包装信息…" : "上传产品照片"}
                  </Button>
                </div>
                <div className="rounded-2xl border p-5">
                  <p className="text-base font-semibold">搜索产品</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    尽量填写完整产品名称，品牌也会帮助更快找到产品。
                  </p>
                  <Button
                    className="mt-4"
                    onClick={() => {
                      setLookupEntry("name");
                    }}
                    type="button"
                  >
                    搜索产品
                  </Button>
                </div>
              </section>
            ) : (
              <section>
                <Button
                  onClick={() => setLookupEntry("choices")}
                  type="button"
                  variant="ghost"
                >
                  返回添加方式
                </Button>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="品牌（可选）">
                    <input
                      className={inputClassName}
                      maxLength={120}
                      onChange={(event) => editIdentity({ brand_name: event.target.value })}
                      placeholder="例如：CeraVe"
                      value={draft.brand_name}
                    />
                  </Field>
                  <Field label="产品名称">
                      <input
                        className={inputClassName}
                        maxLength={200}
                        onChange={(event) => editIdentity({ product_name: event.target.value })}
                        placeholder="例如：保湿洁面乳"
                        value={draft.product_name}
                      />
                  </Field>
                </div>

                <div className="mt-5">
                  <Button
                    disabled={isMatching || !draft.product_name.trim()}
                    onClick={lookupProduct}
                    type="button"
                  >
                    {isMatching ? "正在查找…" : "查找产品"}
                  </Button>
                </div>
              </section>
            )}

          </>
        ) : null}

        {addFlowStage === "candidate_selection" && lookupResult ? (
          <section className="space-y-3">
            <p className="text-sm text-muted-foreground">{lookupMessage}</p>
            {lookupResult.candidates.map((candidate, index) => (
              <CandidateIdentityCard
                actionLabel={recognitionCandidates !== null ? "用此线索查找产品" : "就是这个"}
                candidate={candidate}
                observationOnly={recognitionCandidates !== null}
                key={`${candidate.catalog_product_id ?? candidate.barcode ?? candidate.product_name}:${index}`}
                onAction={() => void chooseLookupCandidate(candidate, recognitionCandidates?.[index] ?? null)}
              />
            ))}
            <Button
              onClick={() => void rejectLookupCandidates()}
              type="button"
              variant="outline"
            >
              都不是
            </Button>
          </section>
        ) : null}

        {addFlowStage === "identity_resolving" ? (
          <section className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
            {identityLoadingMessage || "正在查找产品…"}
          </section>
        ) : null}

        {addFlowStage === "asset_setup" && pendingAssetResolution && draft.product_type ? (
          <section className="space-y-5">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-sm font-semibold">产品信息</p>
              <p className="mt-2 font-medium">{draft.product_name}</p>
              <p className="text-sm text-muted-foreground">{draft.brand_name || "品牌未提供"}</p>
              <p className="mt-2 text-sm text-muted-foreground">产品类型：{PRODUCT_TYPE_META[draft.product_type].label}</p>
              {draft.variant_name ? <p className="text-sm text-muted-foreground">已识别规格：{draft.variant_name}</p> : null}
            </div>
            <div>
              <h3 className="font-semibold">完善我的产品状态</h3>
              <p className="mt-1 text-sm text-muted-foreground">这些信息只属于你手上的这一瓶产品，可跳过后再补充。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="资产分类">
                <select
                  className={inputClassName}
                  value={draft.asset_category}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    asset_category: event.target.value as UserAssetCategory,
                  }))}
                >
                  {ASSET_SECTIONS.map((section) => (
                    <option key={section} value={section}>
                      {ASSET_SECTION_META[section].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="包装规格（可选）"><input className={inputClassName} placeholder="例如：50ml" maxLength={100} value={draft.package_size} onChange={(event) => setDraft((current) => ({ ...current, package_size: event.target.value }))} /></Field>
              <Field label="生产日期（可选）"><input className={inputClassName} type="date" value={draft.manufacture_date} onChange={(event) => setDraft((current) => ({ ...current, manufacture_date: event.target.value }))} /></Field>
              <Field label="使用状态"><select className={inputClassName} value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as NewProductDraft["status"], quantity_remaining_percent: event.target.value === "finished" ? 0 : current.quantity_remaining_percent }))}><option value="active">使用中</option><option value="finished">已用完</option></select></Field>
              {draft.status === "active" ? <Field label={`剩余量：${draft.quantity_remaining_percent}%`}><input className="h-11 w-full accent-primary" type="range" min={0} max={100} value={draft.quantity_remaining_percent} onChange={(event) => setDraft((current) => ({ ...current, quantity_remaining_percent: Number(event.target.value) }))} /></Field> : null}
              <Field label="到期日期（可选）"><input className={inputClassName} type="date" value={draft.expires_on} onChange={(event) => setDraft((current) => ({ ...current, expires_on: event.target.value }))} /></Field>
            </div>
            <Field label="使用偏好"><textarea className="beauty-field min-h-20 py-2" maxLength={2000} placeholder="例如：喜欢晚上使用；夏天减少使用" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => void addInventoryItem({ ...draft, status: DEFAULT_INVENTORY_ADD_STATUS, quantity_remaining_percent: 100, package_size: "", manufacture_date: "", expires_on: "", notes: "" }, pendingAssetResolution)}>暂时跳过</Button><Button type="button" disabled={isSaving} onClick={() => void addInventoryItem(draft, pendingAssetResolution)}>{isSaving ? "正在添加…" : "保存并加入资产"}</Button></div>
          </section>
        ) : null}

        {addFlowStage === "unknown_confirmation" ? (
          <section>
            <p className="mb-5 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
              {lookupMessage}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="品牌（可选）">
                <input
                  className={inputClassName}
                  maxLength={120}
                  onChange={(event) => editIdentity({ brand_name: event.target.value })}
                  placeholder="包装上的品牌"
                  value={draft.brand_name}
                />
              </Field>
              <Field label="产品名称">
                <input
                  className={inputClassName}
                  maxLength={200}
                  onChange={(event) => editIdentity({ product_name: event.target.value })}
                  placeholder="包装上的产品名称"
                  value={draft.product_name}
                />
              </Field>
            </div>
            {draft.barcode ? (
              <p className="mt-4 text-sm text-muted-foreground">
                查询条形码：{draft.barcode}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button onClick={() => setAddFlowStage("lookup")} type="button" variant="outline">
                返回查找
              </Button>
              <Button
                disabled={isSaving || !draft.product_name.trim()}
                onClick={confirmUnknownIdentity}
                type="button"
              >
                {isSaving ? "正在添加…" : "创建待识别资产"}
              </Button>
            </div>
          </section>
        ) : null}

      </Modal>

      <Modal
        description="选择新的剩余比例，确认保存后才会更新。"
        onClose={() => setQuantityEditorProduct(null)}
        open={quantityEditorProduct !== null}
        title="更新剩余量"
      >
        {quantityEditorProduct ? (
          <QuantityQuickEditor
            key={quantityEditorProduct.id}
            onCancel={() => setQuantityEditorProduct(null)}
            onSaved={(saved) => {
              replaceOwnedProduct(
                preserveOwnedProductImagePresentation(quantityEditorProduct, saved),
              );
              setQuantityEditorProduct(null);
              setHasError(false);
              setMessage(`已将${quantityEditorProduct.product.product_name}的剩余量更新为 ${saved.quantity_remaining_percent}%`);
            }}
            ownedProduct={quantityEditorProduct}
          />
        ) : null}
      </Modal>

      <Modal
        onClose={() => setSelectedOwnedProduct(null)}
        open={selectedOwnedProduct !== null}
        title={selectedOwnedProduct ? selectedOwnedProduct.product.product_name : "产品详情"}
      >
        {selectedOwnedProduct ? (
          <InventoryEditor
            key={selectedOwnedProduct.id}
            onArchive={(id) => {
              removeOwnedProduct(id);
              setSelectedOwnedProduct(null);
            }}
            onSaved={(saved) => {
              const next = preserveOwnedProductImagePresentation(selectedOwnedProduct, saved);
              replaceOwnedProduct(next);
              setSelectedOwnedProduct(next);
            }}
            onUploadAdded={addUpload}
            onUploadDeleted={removeUpload}
            ownedProduct={selectedOwnedProduct}
            uploads={getOwnedProductImageUploads(selectedOwnedProduct, uploads)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function InventoryCategorySection({
  groupByBrand,
  section,
  products,
  onOpen,
  onQuickQuantity,
}: {
  groupByBrand: boolean;
  section: AssetSection;
  products: OwnedProduct[];
  onOpen: (ownedProduct: OwnedProduct) => void;
  onQuickQuantity: (ownedProduct: OwnedProduct) => void;
}) {
  const brandSections = groupByBrand ? groupInventoryByBrand(products) : [{ key: "all", label: "", products, isOtherBrands: true }];

  return (
    <section aria-labelledby={`inventory-category-${section}`}>
      <div className="mb-5 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold" id={`inventory-category-${section}`}>
          {ASSET_SECTION_META[section].label}
        </h2>
        <span className="text-sm text-muted-foreground">· {products.length} 件</span>
      </div>
      {products.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          这个分类暂时没有产品。
        </p>
      ) : (
        <div className="space-y-7 sm:space-y-8">
          {brandSections.map((brandSection, brandIndex) => (
            <section
              aria-labelledby={groupByBrand ? `inventory-brand-${section}-${brandIndex}` : undefined}
              key={brandSection.key}
            >
              {groupByBrand ? <div className="mb-3 flex items-baseline gap-2">
                <h3
                  className="text-sm font-semibold sm:text-base"
                  id={`inventory-brand-${section}-${brandIndex}`}
                >
                  {brandSection.label}
                </h3>
                {!brandSection.isOtherBrands ? (
                  <span className="text-sm text-muted-foreground">
                    · {brandSection.products.length}
                  </span>
                ) : null}
              </div> : null}
              <div className="space-y-2 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0 lg:grid-cols-3">
                {brandSection.products.map((ownedProduct) => (
                  <InventoryCard
                    hideBrandOnMobile={!brandSection.isOtherBrands}
                    key={ownedProduct.id}
                    onOpen={() => onOpen(ownedProduct)}
                    onQuickQuantity={() => onQuickQuantity(ownedProduct)}
                    ownedProduct={ownedProduct}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function InventoryCard({
  ownedProduct,
  onOpen,
  onQuickQuantity,
  hideBrandOnMobile = false,
}: {
  ownedProduct: OwnedProduct;
  onOpen: () => void;
  onQuickQuantity?: () => void;
  hideBrandOnMobile?: boolean;
}) {
  const image = ownedProduct.image ?? { resolved_url: null, source: "none" as const, has_override: false };
  const expiry = expiryMessage(ownedProduct.expires_on);

  return (
    <article className="beauty-card beauty-card-interactive relative h-full overflow-hidden">
      <button
        aria-label={`查看 ${ownedProduct.product.product_name} 详情`}
        className="absolute inset-0 z-0 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      />
      <div className="pointer-events-none grid w-full grid-cols-[68px_minmax(0,1fr)_auto] items-center gap-3 p-3 text-left sm:flex sm:h-full sm:flex-col sm:items-stretch sm:gap-0 sm:p-4">
        <div className="flex size-[68px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-lavender-soft/65 sm:hidden">
          <ProductImage alt={`${ownedProduct.product.product_name} 产品图片`} catalogProductId={image.source === "catalog" ? ownedProduct.product.catalog_product_id : null} className="h-full w-full object-contain p-1.5" src={image.resolved_url} />
        </div>
        <div className="min-w-0 sm:hidden">
          {!hideBrandOnMobile ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {ownedProduct.product.brand_name ?? "未填写品牌"}
            </p>
          ) : null}
          <h3 className="line-clamp-2 text-[15px] leading-5 font-semibold tracking-[-0.01em]">
            {ownedProduct.product.product_name}
          </h3>
          <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <span className="truncate">{PRODUCT_TYPE_META[ownedProduct.product.product_type].label}</span>
            <span aria-hidden="true">·</span>
            <span>{displayStatusLabel(ownedProduct.status)}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            剩余约 {ownedProduct.quantity_remaining_percent}%
            {ownedProduct.expires_on ? <span className={`ml-2 ${expiry.tone}`}>{expiry.label}</span> : null}
          </p>
        </div>
        <div className="flex h-full min-h-[68px] flex-col items-end justify-between sm:hidden">
          <span aria-hidden="true" className="text-lg text-muted-foreground">›</span>
          {onQuickQuantity ? (
            <button
              aria-label={`更新 ${ownedProduct.product.product_name} 剩余量`}
              className="pointer-events-auto relative z-10 flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onQuickQuantity}
              type="button"
            >
              更新
            </button>
          ) : null}
        </div>

        <div className="hidden gap-4 sm:flex sm:flex-col">
          <div className="beauty-product-stage flex h-36 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl lg:h-40">
            <ProductImage alt={`${ownedProduct.product.product_name} 产品图片`} catalogProductId={image.source === "catalog" ? ownedProduct.product.catalog_product_id : null} className="h-full w-full object-contain p-4" src={image.resolved_url} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">
              {ownedProduct.product.brand_name ?? "未填写品牌"}
            </p>
            <h3 className="mt-1 line-clamp-2 text-[15px] leading-5 font-semibold tracking-[-0.01em]">{ownedProduct.product.product_name}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{PRODUCT_TYPE_META[ownedProduct.product.product_type].label}</span>
              <span aria-hidden="true">·</span>
              <span className="text-secondary-foreground">{displayStatusLabel(ownedProduct.status)}</span>
            </div>
          </div>
        </div>
        <div className="mt-auto hidden pt-4 sm:block">
          {ownedProduct.expires_on ? (
            <p className={`mb-3 text-xs ${expiry.tone}`}>{expiry.label}</p>
          ) : null}
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">剩余约 {ownedProduct.quantity_remaining_percent}%</span>
            {onQuickQuantity ? (
              <button
                aria-label={`更新 ${ownedProduct.product.product_name} 剩余量`}
                className="pointer-events-auto relative z-10 rounded-md px-1.5 py-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onQuickQuantity}
                type="button"
              >
                更新
              </button>
            ) : null}
          </div>
          <div aria-label={`剩余量 ${ownedProduct.quantity_remaining_percent}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={ownedProduct.quantity_remaining_percent} className="beauty-progress mt-1.5" role="progressbar">
            <div
              className="beauty-progress-indicator"
              style={{ width: `${ownedProduct.quantity_remaining_percent}%` }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function CandidateIdentityCard({
  actionLabel,
  candidate,
  onAction,
  observationOnly = false,
}: {
  actionLabel?: string;
  candidate: UserProductLookupCandidate;
  onAction?: () => void;
  observationOnly?: boolean;
}) {
  const content = (
    <>
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/60">
          <ProductImage alt="候选产品图片" catalogProductId={candidate.candidate_kind === "catalog" ? candidate.catalog_product_id : null} className="h-full w-full object-contain p-2" src={candidate.image_preview_url} />
        </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">
          {candidate.candidate_kind === "external" ? "可能是：" : "找到产品"}
        </p>
        <p className="text-sm text-muted-foreground">
          品牌：{candidate.brand_name ?? "暂未识别"}{candidate.brand_name && candidate.candidate_source === "ai" ? " ✓" : ""}
        </p>
        <h3 className="mt-1 font-semibold">产品名称：{candidate.product_name}{candidate.candidate_source === "ai" ? " ✓" : ""}</h3>
        {candidate.variant_name ? <p className="mt-1 text-sm text-muted-foreground">规格：{candidate.variant_name}</p> : null}
        {(!observationOnly && candidate.candidate_kind === "external") || candidate.source_reference ? (
            <p className="mt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">来源：</span>
            {candidate.source_reference?.display_name ?? "公开产品来源"}
            </p>
        ) : null}
      </div>
    </>
  );

  if (onAction) {
    return (
      <div className="flex w-full items-start gap-4 rounded-xl border bg-card p-4 text-left">
        {content}
        {actionLabel ? <button className="shrink-0 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" onClick={onAction} type="button">{actionLabel}</button> : null}
      </div>
    );
  }

  return <div className="flex items-start gap-4 rounded-xl border bg-card p-4">{content}</div>;
}

function Modal({
  children,
  description,
  onClose,
  open,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="beauty-modal-backdrop" />
        <Dialog.Viewport className="beauty-modal-viewport">
          <Dialog.Popup className="beauty-sheet beauty-modal-popup sm:max-w-2xl">
            <div aria-hidden="true" className="beauty-sheet-handle" />
            <div className="beauty-sheet-header flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-2 text-sm text-muted-foreground">{description}</Dialog.Description> : null}
              </div>
              <Dialog.Close aria-label="关闭" className="beauty-icon-control shrink-0" type="button">×</Dialog.Close>
            </div>
            <div className="beauty-sheet-content pt-3">{children}</div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InventoryEditor({
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
  const [status, setStatus] = useState<InventoryUiStatus>(
    normalizeInventoryUiStatus(ownedProduct.status),
  );
  const [quantity, setQuantity] = useState(ownedProduct.quantity_remaining_percent);
  const [assetCategory, setAssetCategory] = useState<UserAssetCategory>(
    ownedProduct.asset_category ?? "other",
  );
  const [packageSize, setPackageSize] = useState(ownedProduct.package_size ?? "");
  const [manufactureDate, setManufactureDate] = useState(
    ownedProduct.manufacture_date ?? "",
  );
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
          asset_category: assetCategory,
          status,
          package_size: packageSize.trim() || null,
          manufacture_date: manufactureDate || null,
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
    if (!window.confirm("移除后将从当前资产列表隐藏，确认继续吗？")) {
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
      setMessage("移除失败");
      setIsSaving(false);
    }
  }

  const expiryHint = getExpiryInformationHint({ expires_on: expiresOn || null });

  return (
    <div>
      <section className="rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-semibold">产品信息</p>
        <h3 className="mt-3 font-semibold">{ownedProduct.product.product_name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {ownedProduct.product.brand_name ?? "品牌未提供"}
        </p>
        <dl className="mt-4 grid gap-3 text-sm">
          <Detail label="产品类型" value={PRODUCT_TYPE_META[ownedProduct.product.product_type].label} />
        </dl>
      </section>

      <section className="mt-5 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-semibold">我的资产</h3>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs">剩余量 {quantity}%</span>
        </div>
        {expiryHint ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {expiryHint}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="资产分类">
          <select
            className={inputClassName}
            onChange={(event) => setAssetCategory(event.target.value as UserAssetCategory)}
            value={assetCategory}
          >
            {ASSET_SECTIONS.map((section) => (
              <option key={section} value={section}>
                {ASSET_SECTION_META[section].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="包装规格">
          <input
            className={inputClassName}
            maxLength={100}
            onChange={(event) => setPackageSize(event.target.value)}
            placeholder="例如：50ml"
            value={packageSize}
          />
        </Field>
        <Field label="生产日期">
          <input
            className={inputClassName}
            onChange={(event) => setManufactureDate(event.target.value)}
            type="date"
            value={manufactureDate}
          />
        </Field>
        <Field label="状态">
          <select
            className={inputClassName}
            onChange={(event) => {
              const nextStatus = event.target.value as InventoryUiStatus;
              setStatus(nextStatus);
              if (nextStatus === "finished") setQuantity(0);
            }}
            value={status}
          >
            {INVENTORY_UI_STATUSES.map((item) => (
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
        <Field label="到期日期（可选）">
          <input
            className={inputClassName}
            onChange={(event) => setExpiresOn(event.target.value)}
            type="date"
            value={expiresOn}
          />
        </Field>
        </div>
        <Field className="mt-4" label="使用偏好">
          <textarea
            className="beauty-field min-h-20 py-2 font-normal"
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="例如：喜欢晚上使用；不喜欢厚重肤感；出门旅行优先携带；喜欢搭配某个产品"
            value={notes}
          />
        </Field>

      </section>

      <ProductImageUploader
        onUploadAdded={onUploadAdded}
        onUploadDeleted={onUploadDeleted}
        ownedProduct={ownedProduct}
        uploads={uploads}
      />

      <div className="mt-4 flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {message}
        </p>
        <div className="flex gap-2">
          <Button disabled={isSaving} onClick={archive} type="button" variant="destructive">
            从资产中移除
          </Button>
          <Button disabled={isSaving} onClick={save} type="button">
            {isSaving ? "处理中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProductImageUploader({
  ownedProduct,
  uploads,
  onUploadAdded,
  onUploadDeleted,
}: {
  ownedProduct: OwnedProduct;
  uploads: UploadAsset[];
  onUploadAdded: (upload: UploadAsset) => void;
  onUploadDeleted: (id: string) => void;
}) {
  const image = ownedProduct.image ?? { resolved_url: null, source: "none" as const, has_override: false };
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
      setMessage("正在添加图片…");
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
          owned_product_id: ownedProduct.id,
        }),
      });
      const taskResult: unknown = await taskResponse.json();
      const task = parseData(taskResult, uploadTaskSchema);

      if (!taskResponse.ok || !task) {
        throw new Error("UPLOAD_TASK_FAILED");
      }

      uploadId = task.asset.id;
      setMessage("正在添加图片…");
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

      setMessage("正在添加图片…");
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
      setMessage("已添加我的图片。");
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
    if (id === ownedProduct.image_override_upload_id) window.location.reload();
  }

  async function restoreDefault() {
    const response = await fetch(`/api/v1/owned-products/${ownedProduct.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_override_upload_id: null }),
    });
    if (!response.ok) {
      setStatus("error");
      setMessage("恢复默认图片失败，请稍后重试。");
      return;
    }
    setStatus("success");
    setMessage("已改用产品默认图。");
    window.location.reload();
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
          <h4 className="text-sm font-medium">我的产品图片</h4>
          <p className="mt-1 text-xs text-muted-foreground">可选；未添加也不影响产品管理。支持 JPEG、PNG 或 WebP，最大 5 MB。</p>
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
          {status === "uploading" ? "添加中…" : image.source === "user_override" ? "更换我的图片" : "添加我的图片"}
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

      <div className="mt-4 flex h-40 items-center justify-center overflow-hidden rounded-lg border bg-muted/60">
        <ProductImage alt={`${ownedProduct.product.product_name} 产品图片`} catalogProductId={image.source === "catalog" ? ownedProduct.product.catalog_product_id : null} className="h-full w-full object-contain p-3" src={image.resolved_url} />
      </div>

      {image.has_override ? (
        <Button className="mt-3" onClick={restoreDefault} type="button" variant="outline">改用产品默认图</Button>
      ) : null}

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
                  {uploadStatusLabel(upload.status)}
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
                    查看大图
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

function displayStatusLabel(status: OwnedProduct["status"]) {
  return status === "archived"
    ? archivedStatusLabel
    : statusLabels[normalizeInventoryUiStatus(status)];
}

function normalizeInventoryUiStatus(status: OwnedProduct["status"]): InventoryUiStatus {
  if (status === "unopened") return "active";
  if (status === "archived") return "paused";
  return status;
}

function ProductImage({ alt, catalogProductId, className, src }: { alt: string; catalogProductId?: string | null; className: string; src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const cachedSrc = src && catalogProductId
    ? `/api/v1/catalog-products/${catalogProductId}/image`
    : null;
  const displayedSrc = cachedSrc && failedSrc !== cachedSrc ? cachedSrc : src;
  if (!displayedSrc || failedSrc === src) return <ProductImagePlaceholder />;
  return <img alt={alt} className={className} onError={() => setFailedSrc(displayedSrc)} src={displayedSrc} />;
}

function ProductImagePlaceholder() {
  return (
    <span aria-label="暂无产品图片" className="flex h-full w-full items-center justify-center text-muted-foreground/45" role="img">
      <svg aria-hidden="true" className="h-10 w-10" fill="none" viewBox="0 0 32 32">
        <path d="M12 4h8v5l3 3v13a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V12l3-3V4Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 9h8M9 15h14" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

function uploadStatusLabel(status: UploadAsset["status"]) {
  if (status === "ready") return "已添加";
  if (status === "pending") return "处理中";
  return "未能完成";
}

function isExpiringSoon(expiresOn: string | null) {
  if (!expiresOn) return false;
  const days = daysUntil(expiresOn);
  return days >= 0 && days <= 30;
}

export function expiryMessage(expiresOn: string | null) {
  if (!expiresOn) {
    return { label: "未设置到期日", tone: "text-muted-foreground" };
  }

  const days = daysUntil(expiresOn);
  if (days < 0) {
    return { label: `已于 ${expiresOn} 到期`, tone: "text-destructive" };
  }
  if (days <= 30) {
    return { label: `${expiresOn} 到期 · 请优先使用`, tone: "text-warning" };
  }
  return { label: `到期日：${expiresOn}`, tone: "text-muted-foreground" };
}

function daysUntil(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const today = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(today.map((part) => [part.type, part.value]));
  const todayUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  return Math.floor((Date.UTC(year, month - 1, day) - todayUtc) / 86_400_000);
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
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

function readApiErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

const inputClassName =
  "beauty-field font-normal";

function inventoryFilterClassName(selected: boolean) {
  return `beauty-chip ${
    selected ? "beauty-chip-selected" : ""
  }`;
}
