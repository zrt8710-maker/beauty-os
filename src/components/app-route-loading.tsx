import { BrandLoading } from "@/components/brand-loading";

export function AppRouteLoading() {
  return (
    <main className="beauty-page" aria-busy="true" aria-live="polite">
      <section className="max-w-3xl border-t border-border/80 pt-6">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-48 max-w-full animate-pulse rounded bg-muted" />
        <div className="mt-5 space-y-2.5">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
        </div>
        <BrandLoading label="正在整理页面内容…" />
      </section>
    </main>
  );
}
