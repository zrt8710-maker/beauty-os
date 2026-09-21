"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { HomeQuantityCheckSheet } from "@/features/home/home-quantity-check-sheet";
import type { HomeAttentionItem } from "@/features/home/home-attention-view-model";
import type { InventoryQuantityAttention } from "@/features/home/inventory-quantity-attention";
import { cn } from "@/lib/utils";

export function visibleHomeAttentionItems(
  items: HomeAttentionItem[],
  dismissedProfileSuggestion: boolean,
) {
  return dismissedProfileSuggestion
    ? items.filter((item) => item.kind !== "profile_suggestion")
    : items;
}

export function HomeAttention({ compact = false, items }: { compact?: boolean; items: HomeAttentionItem[] }) {
  const [dismissedProfileSuggestion, setDismissedProfileSuggestion] = useState(false);
  const [quantityCheck, setQuantityCheck] = useState<InventoryQuantityAttention | null>(null);
  const visibleItems = visibleHomeAttentionItems(items, dismissedProfileSuggestion);
  if (!visibleItems.length) return null;

  if (compact) {
    return (
      <section aria-label="今天需要你留意">
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-1 py-3 text-sm font-medium">
            <span>今天有 {visibleItems.length} 件事值得留意</span>
            <span aria-hidden="true">查看 →</span>
          </summary>
          <div className="beauty-details-content border-t">
            {visibleItems.map((item) => (
              <article className="py-3" key={item.id}>
                <h3 className="text-sm font-medium">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <AttentionAction item={item} onQuantityCheck={setQuantityCheck} />
                  {item.kind === "profile_suggestion" ? (
                    <Button onClick={() => setDismissedProfileSuggestion(true)} size="sm" type="button" variant="ghost">
                      暂不
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </details>
        {quantityCheck ? <HomeQuantityCheckSheet attention={quantityCheck} onClose={() => setQuantityCheck(null)} /> : null}
      </section>
    );
  }

  return (
    <section aria-label="今天需要你留意" className="space-y-3">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-xl font-semibold">今天需要你留意</h2>
        <span className="text-sm text-muted-foreground">{visibleItems.length}</span>
      </div>
      <div className="space-y-3">
        {visibleItems.map((item) => (
          <article
            className={item.kind === "asset_expired"
              ? "rounded-2xl border border-warning/30 bg-warning/5 p-5"
              : "rounded-2xl border bg-card p-5"}
            key={item.id}
          >
            <h3 className="font-medium">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <AttentionAction item={item} onQuantityCheck={setQuantityCheck} />
              {item.kind === "profile_suggestion" ? (
                <Button
                  onClick={() => setDismissedProfileSuggestion(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  暂不
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {quantityCheck ? <HomeQuantityCheckSheet attention={quantityCheck} onClose={() => setQuantityCheck(null)} /> : null}
    </section>
  );
}

export function HomeAttentionNotification({ items }: { items: HomeAttentionItem[] }) {
  const [dismissedProfileSuggestion, setDismissedProfileSuggestion] = useState(false);
  const [quantityCheck, setQuantityCheck] = useState<InventoryQuantityAttention | null>(null);
  const visibleItems = visibleHomeAttentionItems(items, dismissedProfileSuggestion).slice(0, 2);

  return (
    <section aria-label="通知入口" className="relative shrink-0">
      <details className="group relative">
        <summary className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-9 cursor-pointer list-none gap-2 px-2 text-xs sm:h-11 sm:px-3 sm:text-sm")}>
          <BeautyNavIcon name="notification" size={16} />
          <span>通知</span>
          {visibleItems.length > 0 ? (
            <span aria-label={`${visibleItems.length} 条提醒`} className="flex min-h-5 min-w-5 items-center justify-center rounded-full border px-1 text-xs">
              {visibleItems.length}
            </span>
          ) : null}
        </summary>
        <div className="beauty-details-content absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-background p-3 shadow-[var(--shadow-button-soft)]">
          <p className="px-1 pb-2 text-sm font-medium">今天需要留意</p>
          {visibleItems.length > 0 ? (
            <div className="divide-y">
              {visibleItems.map((item) => (
                <article className="py-3" key={item.id}>
                  <h2 className="text-sm font-medium">{item.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <AttentionAction item={item} onQuantityCheck={setQuantityCheck} />
                    {item.kind === "profile_suggestion" ? (
                      <Button onClick={() => setDismissedProfileSuggestion(true)} size="sm" type="button" variant="ghost">
                        暂不
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="px-1 py-3 text-sm text-muted-foreground">今天没有需要特别留意的事项。</p>
          )}
        </div>
      </details>
      {quantityCheck ? <HomeQuantityCheckSheet attention={quantityCheck} onClose={() => setQuantityCheck(null)} /> : null}
    </section>
  );
}

function AttentionAction({
  item,
  onQuantityCheck,
}: {
  item: HomeAttentionItem;
  onQuantityCheck: (attention: InventoryQuantityAttention) => void;
}) {
  const quantityCheck = item.quantityCheck;
  if (item.kind === "inventory_quantity_check" && quantityCheck) {
    return (
      <Button onClick={() => onQuantityCheck(quantityCheck)} size="sm" type="button" variant="outline">
        {item.actionLabel}
      </Button>
    );
  }

  return (
    <Button nativeButton={false} render={<Link href={item.href} />} size="sm" variant="outline">
      {item.actionLabel}
    </Button>
  );
}
