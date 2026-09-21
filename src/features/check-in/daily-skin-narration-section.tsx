import { Button } from "@/components/ui/button";

export function DailySkinNarrationSection({ date, message, narration, onAdjust }: { date: string; message: string; narration: string; onAdjust: () => void }) {
  return (
    <section aria-label="今天的皮肤状态">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-base font-semibold">今天 <span className="text-sm font-normal text-muted-foreground">· {date}</span></h2>
          <span className="text-xs text-muted-foreground">已记录</span>
        </div>
        <Button onClick={onAdjust} size="sm" type="button" variant="secondary">调整今日状态</Button>
      </div>
      <p className="mt-3 max-w-[68ch] text-[15px] leading-7">{narration}</p>
      {message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}
