import { SKIN_GRADING_CONFIG } from "@/domain/skin-grading/skin-grading-config";
import type { DailyStateConcernKind } from "@/schemas/checkin";

type SkinGradingHelpProps = {
  concern: DailyStateConcernKind;
  triggerLabel: string;
  context?: "today" | "usual";
  includeAbsentAnchor?: boolean;
};

/** Shared consumer help for reports and editors. It intentionally exposes only prose guidance. */
export function SkinGradingHelp({ concern, triggerLabel, context = "today", includeAbsentAnchor = false }: SkinGradingHelpProps) {
  const definition = SKIN_GRADING_CONFIG[concern];
  const observation = definition.observation_method;
  const grades = includeAbsentAnchor ? [0, 1, 2, 3, 4] as const : [1, 2, 3, 4] as const;
  const groups = [
    ["看哪里", observation.where_to_look],
    ["怎么观察", observation.how_to_observe],
    ["重点看什么", observation.what_to_notice],
    ["触摸辅助", observation.touch_guidance],
    ["适合判断时", observation.good_conditions],
    ["避免在这些情况下判断", observation.avoid_conditions],
  ] as const;

  return <details className="mt-2 text-muted-foreground"><summary className="cursor-pointer text-sm font-medium text-foreground underline underline-offset-4">{triggerLabel}</summary><div className="mt-3 space-y-5 rounded-lg border bg-background p-3"><div><p className="font-medium text-foreground">{definition.label.replace(/\s*\/\s*/g, " / ")}怎么看？</p>{context === "usual" ? <p className="mt-1">这是平时通常的程度。</p> : <p className="mt-1">本次程度根据今天已经确认的皮肤状态整理。</p>}</div><section><h3 className="font-medium text-foreground">怎么看</h3><div className="mt-2 space-y-3">{groups.map(([title, items]) => items?.length ? <div key={title}><p className="font-medium text-foreground">{title}</p><ul className="mt-1 list-disc space-y-1 pl-5">{items.map((item) => <li key={item}>{item}</li>)}</ul></div> : null)}{observation.plain_language_note ? <p>{observation.plain_language_note}</p> : null}</div></section><section><h3 className="font-medium text-foreground">程度参考</h3><ul className="mt-2 space-y-3">{grades.map((grade) => { const anchor = definition.anchors[grade]; return <li key={anchor.id}><p className="font-medium text-foreground">{anchor.label}</p><p>{anchor.description}</p></li>; })}</ul></section></div></details>;
}
