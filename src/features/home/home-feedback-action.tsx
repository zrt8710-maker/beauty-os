"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { RoutinePeriod } from "@/schemas/routine";

export type HomeFeedbackRoutine = {
  id: string;
  period: RoutinePeriod;
  status: string;
};

export function usageFeedbackHref(routine: Pick<HomeFeedbackRoutine, "id" | "period">) {
  return `/usage-feedback?routineId=${encodeURIComponent(routine.id)}&period=${routine.period}`;
}

export function resolveHomeFeedbackAction(routines: HomeFeedbackRoutine[]) {
  const ordered = [...routines].sort((left, right) => left.period.localeCompare(right.period));
  if (ordered.length === 0) return { kind: "empty" as const };
  if (ordered.length === 1) return { kind: "direct" as const, routine: ordered[0] };
  return { kind: "choose" as const, routines: ordered };
}

export function HomeFeedbackAction({ routines }: { routines: HomeFeedbackRoutine[] }) {
  const [open, setOpen] = useState(false);
  const action = resolveHomeFeedbackAction(routines);

  if (action.kind === "direct") {
    return <Button className="h-8 px-2 text-xs" nativeButton={false} render={<Link href={usageFeedbackHref(action.routine)} />} variant="ghost">使用反馈</Button>;
  }

  return (
    <div className="relative">
      <Button aria-expanded={open} className="h-8 px-2 text-xs" onClick={() => setOpen((current) => !current)} type="button" variant="ghost">使用反馈</Button>
      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 min-w-52 rounded-xl border bg-background p-3 text-sm">
          {action.kind === "choose" ? (
            <>
              <p className="mb-2 font-medium">选择要反馈的方案</p>
              <div className="grid gap-1">
                {action.routines.map((routine) => <Button className="justify-start" key={routine.id} nativeButton={false} render={<Link href={usageFeedbackHref(routine)} />} variant="ghost">{routine.period === "am" ? "AM · 早间" : "PM · 晚间"}</Button>)}
              </div>
            </>
          ) : (
            <>
              <p>今天还没有可反馈的护理方案。</p>
              <Button className="mt-2" nativeButton={false} render={<Link href="/today/am" />} variant="ghost">查看今日方案</Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
