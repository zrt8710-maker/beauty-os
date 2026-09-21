"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ownedProductSchema, type OwnedProduct } from "@/schemas/product";

export type QuantityQuickProduct = {
  id: string;
  quantity_remaining_percent: number;
  product: {
    product_name: string;
  };
};

const QUICK_QUANTITY_VALUES = [100, 75, 50, 25, 10] as const;

export function QuantityQuickEditor({
  ownedProduct,
  onCancel,
  onSaved,
}: {
  ownedProduct: QuantityQuickProduct;
  onCancel: () => void;
  onSaved: (saved: OwnedProduct) => void;
}) {
  const rangeId = useId();
  const [quantity, setQuantity] = useState(
    ownedProduct.quantity_remaining_percent,
  );
  const [isSavingQuantity, setIsSavingQuantity] = useState(false);
  const [quantityMessage, setQuantityMessage] = useState("");

  async function saveQuantity() {
    setIsSavingQuantity(true);
    setQuantityMessage("");

    try {
      const response = await fetch(`/api/v1/owned-products/${ownedProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity_remaining_percent: quantity }),
      });
      const result: unknown = await response.json();
      const saved = parseData(result, ownedProductSchema);
      if (!response.ok || !saved) throw new Error("QUANTITY_UPDATE_FAILED");
      onSaved(saved);
    } catch {
      setQuantityMessage("剩余量更新失败，请稍后重试。");
      setIsSavingQuantity(false);
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{ownedProduct.product.product_name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            当前记录余量 {ownedProduct.quantity_remaining_percent}%
          </p>
        </div>
        <output className="shrink-0 text-2xl font-semibold" htmlFor={rangeId}>
          {quantity}%
        </output>
      </div>

      <label className="mt-6 block text-sm font-medium" htmlFor={rangeId}>
        调整剩余量
      </label>
      <input
        className="mt-3 w-full accent-foreground"
        id={rangeId}
        max="100"
        min="0"
        onChange={(event) => setQuantity(Number(event.target.value))}
        step="5"
        type="range"
        value={quantity}
      />

      <div className="mt-5 grid grid-cols-5 gap-2">
        {QUICK_QUANTITY_VALUES.map((value) => (
          <button
            aria-pressed={quantity === value}
            className={`beauty-chip px-1 ${
              quantity === value ? "beauty-chip-selected" : ""
            }`}
            key={value}
            onClick={() => setQuantity(value)}
            type="button"
          >
            {value}%
          </button>
        ))}
      </div>

      {quantityMessage ? (
        <p aria-live="polite" className="mt-4 text-sm text-destructive">
          {quantityMessage}
        </p>
      ) : null}

      <div className="mt-7 flex justify-end gap-2">
        <Button disabled={isSavingQuantity} onClick={onCancel} type="button" variant="outline">
          取消
        </Button>
        <Button disabled={isSavingQuantity} onClick={saveQuantity} type="button">
          {isSavingQuantity ? "保存中…" : "保存剩余量"}
        </Button>
      </div>
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
