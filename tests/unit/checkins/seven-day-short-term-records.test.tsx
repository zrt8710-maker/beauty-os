import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CheckinManager } from "@/features/check-in/checkin-manager";

describe("Seven-day short-term records UI", () => {
  it("renders a non-navigable short-term summary list without history/report controls", () => {
    const html = renderToStaticMarkup(<CheckinManager initialCheckins={[]} today="2026-09-01" profile={null} recentTrends={[]} history={{ unsettledDaily: [{ date: "2026-09-01", summary: "今天整体状态以T 区出油、脸颊发干为主，这些是今天已经确认到的主要表现。脸颊发干是今天新确认到的变化，值得接下来稍作留意。" }], weeklySummaries: [], monthlySummaries: [] }} />);
    expect(html).toContain("最近七天");
    expect(html).toContain("今天整体状态以T 区出油、脸颊发干为主");
    expect(html).toContain("已记录 1 / 7 天");
    expect(html).toContain("阶段总结");
    expect(html).toContain("sm:grid-cols-[7.5rem_minmax(0,1fr)]");
    expect(html).not.toContain("bg-secondary/55");
    expect(html).not.toContain("rounded-2xl border border-border/80 bg-card/90");
    expect(html).toContain("今天 <span");
    expect(html).toContain("尚未记录");
    expect(html).toContain("完成 7 天记录后，这里会生成本周皮肤总结。");
    expect(html).toContain("完成本月记录后，这里会生成月度皮肤总结。");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("本周尚未总结的记录");
    expect(html).not.toContain("查看当天报告");
    expect(html).not.toContain("已保存当天皮肤观察");
    expect(html).not.toContain("/check-in?date=");
  });

  it("keeps completed batches in a separate weekly summary section", () => {
    const html = renderToStaticMarkup(<CheckinManager initialCheckins={[]} today="2026-09-08" profile={null} recentTrends={[]} history={{ unsettledDaily: [{ date: "2026-09-08", summary: "今天整体状态以T 区出油为主，这些是今天已经确认到的主要表现。这份记录主要反映当天的局部状态，适合继续按日常节奏观察。这份短记录只概括当天重点，不延伸到没有确认的皮肤维度。" }], weeklySummaries: [weeklySummary("2026-09-01", "2026-09-07", "本周整体状态比较稳定。")], monthlySummaries: [] }} />);
    expect(html).toContain("周总结");
    expect(html).toContain("9/1–9/7");
    expect(html).not.toContain("完成 7 天记录后，这里会生成本周皮肤总结。");
  });

  it("shows a completed seven-record batch and its summary at the same time", () => {
    const html = renderToStaticMarkup(<CheckinManager initialCheckins={[]} today="2026-09-07" profile={null} recentTrends={[]} history={{ unsettledDaily: Array.from({ length: 7 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, summary: `第 ${index + 1} 条记录` })), weeklySummaries: [weeklySummary("2026-09-01", "2026-09-07", "本组七条记录已生成总结。")], monthlySummaries: [] }} />);

    expect(html).toContain("已记录 7 / 7 天");
    expect(html).toContain("第 7 条记录");
    expect(html).toContain("周总结");
    expect(html).toContain("9/1–9/7");
  });
});

function weeklySummary(start: string, end: string, overall: string) { return { period: { start, end }, recorded_count: 7, recorded_dates: [], overall, worsened: [], improved: [], stable: [], new_or_emerging: [], repeated_observations: [], ungraded_observation_count: 0, has_recent_trends: false, next_week_watch: [] }; }
