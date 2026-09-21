import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeAttention, HomeAttentionNotification, visibleHomeAttentionItems } from "@/features/home/home-attention";
import type { HomeAttentionItem } from "@/features/home/home-attention-view-model";

const asset: HomeAttentionItem = {
  id: "asset-expired",
  kind: "asset_expired",
  priority: 400,
  title: "有产品已经到期",
  description: "颐莲 · 玻尿酸保湿喷雾已到期。",
  actionLabel: "查看资产",
  href: "/inventory",
};
const profile: HomeAttentionItem = {
  id: "profile-suggestion:usual",
  kind: "profile_suggestion",
  priority: 100,
  title: "长期皮肤档案有一条更新建议",
  description: "最近几周，脸颊多次出现发干。",
  actionLabel: "看看建议",
  href: "/profile?suggestion=usual_area&concern=dryness&area=cheeks",
};

describe("HomeAttention", () => {
  it("renders nothing for the empty state", () => {
    expect(renderToStaticMarkup(<HomeAttention items={[]} />)).toBe("");
  });

  it("renders the aggregate count and existing destinations", () => {
    const html = renderToStaticMarkup(<HomeAttention items={[asset, profile]} />);
    expect(html).toContain("今天需要你留意");
    expect(html).toContain("查看资产");
    expect(html).toContain('href="/inventory"');
    expect(html).toContain("看看建议");
    expect(html).toContain("/profile?suggestion=usual_area&amp;concern=dryness&amp;area=cheeks");
    expect(html).not.toMatch(/moderate|strength|confidence|internal/);
  });

  it("collapses populated attention into a lightweight summary on Home", () => {
    const html = renderToStaticMarkup(<HomeAttention compact items={[asset, profile]} />);

    expect(html).toContain("<details>");
    expect(html).toContain("今天有 2 件事值得留意");
    expect(html).not.toContain("rounded-2xl border");
  });

  it("keeps the notification entry visible without a badge when there are no reminders", () => {
    const html = renderToStaticMarkup(<HomeAttentionNotification items={[]} />);

    expect(html).toContain("通知");
    expect(html).not.toContain("条提醒");
  });

  it("shows a notification badge and keeps reminder details inside the popover", () => {
    const html = renderToStaticMarkup(<HomeAttentionNotification items={[asset, profile]} />);

    expect(html).toContain("2 条提醒");
    expect(html).toContain("今天需要留意");
    expect(html).toContain("有产品已经到期");
    expect(html).toContain("长期皮肤档案有一条更新建议");
  });

  it("keeps the existing in-memory profile dismissal behavior", () => {
    expect(visibleHomeAttentionItems([asset, profile], true)).toEqual([asset]);
    expect(visibleHomeAttentionItems([profile], true)).toEqual([]);
  });
});
