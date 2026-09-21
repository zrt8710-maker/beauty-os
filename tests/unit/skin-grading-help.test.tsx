import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SkinGradingHelp } from "@/features/skin-grading/skin-grading-help";

describe("SkinGradingHelp", () => {
  it("shows oiliness observation guidance before the text-only degree reference", () => {
    const html = renderToStaticMarkup(<SkinGradingHelp concern="oiliness" triggerLabel="查看程度说明" />);
    expect(html).toContain("出油怎么看？");
    expect(html).toContain("怎么看");
    expect(html).toContain("程度参考");
    expect(html.indexOf("怎么看")).toBeLessThan(html.indexOf("程度参考"));
    expect(html).not.toMatch(/anchor_id|confidence|raw evidence|rationale|>0<|>4</);
  });

  it("keeps small-bump regions, soft side light, and touch guidance in the centralized help", () => {
    const html = renderToStaticMarkup(<SkinGradingHelp concern="small_bumps" triggerLabel="怎么看？" />);
    expect(html).toContain("额头、下巴、脸颊");
    expect(html).toContain("柔和侧光");
    expect(html).toContain("干净指腹轻摸");
  });

  it("uses the Profile context without changing the shared help structure", () => {
    const html = renderToStaticMarkup(<SkinGradingHelp concern="blackheads" context="usual" triggerLabel="怎么看这个程度？" />);
    expect(html).toContain("这是平时通常的程度。");
    expect(html.indexOf("怎么看")).toBeLessThan(html.indexOf("程度参考"));
  });
});
