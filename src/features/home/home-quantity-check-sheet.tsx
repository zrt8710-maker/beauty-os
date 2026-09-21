"use client";

import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useBeautyDialog } from "@/components/use-beauty-dialog";
import type { InventoryQuantityAttention } from "@/features/home/inventory-quantity-attention";
import { QuantityQuickEditor } from "@/features/inventory/quantity-quick-editor";

export function HomeQuantityCheckSheet({
  attention,
  onClose,
}: {
  attention: InventoryQuantityAttention | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useBeautyDialog(Boolean(attention), onClose);
  if (!attention || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-labelledby="home-quantity-check-title"
      aria-modal="true"
      className="beauty-overlay z-[90]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="beauty-sheet sm:max-w-lg" ref={dialogRef} tabIndex={-1}>
        <div aria-hidden="true" className="beauty-sheet-handle" />
        <div className="beauty-sheet-header flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold" id="home-quantity-check-title">检查余量</h2>
            <p className="mt-2 text-sm text-muted-foreground">确认保存后才会更新资产记录。</p>
          </div>
          <Button aria-label="关闭" onClick={onClose} size="icon" type="button" variant="ghost">×</Button>
        </div>
        <div className="beauty-sheet-content pt-3">
          <QuantityQuickEditor
            ownedProduct={{
              id: attention.owned_product_id,
              quantity_remaining_percent: attention.current_recorded_quantity,
              product: { product_name: attention.product_display_name },
            }}
            onCancel={onClose}
            onSaved={() => {
              onClose();
              router.refresh();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
