import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("global navigation performance contract", () => {
  it("loads Home check-ins once and derives trends from the same records", async () => {
    const contents = await source("src/app/(app)/app/page.tsx");
    expect(contents.match(/listCheckins\(/g)).toHaveLength(1);
    expect(contents).toContain("buildRecentSkinTrends(checkins, today)");
    expect(contents).toContain("checkins.slice(0, 28)");
  });

  it("keeps Home focused on conversation and derives notifications from existing data", async () => {
    const contents = await source("src/app/(app)/app/page.tsx");
    expect(contents.match(/routineRepository\.listByDate\(user\.id, today\)/g)).toHaveLength(1);
    expect(contents).not.toContain("HomeTodayStatus");
    expect(contents).not.toContain("HomeRecentSkin");
    expect(contents).not.toContain("HomeQuickLinks");
    expect(contents).not.toContain("HomeWeatherContext");
    expect(contents).not.toContain("今天想从哪里开始？可以直接告诉我。");
    expect(contents).toContain("<HomeAttentionNotification");
    expect(contents).toContain("<SkinConversationSection");
    expect(contents).toContain("topActions={<HomeAttentionNotification");
    expect(contents).toContain("buildHomeAttentionItems");
    expect(contents).toContain("feedbackRoutines");
  });

  it("keeps Profile and Check-in off the weather context", async () => {
    for (const route of ["profile", "check-in"]) {
      const contents = await source(`src/app/(app)/${route}/page.tsx`);
      expect(contents).toContain("getProfileContext");
      expect(contents).not.toContain("getAppShellContext");
    }
  });

  it("loads both Today routines in one repository query", async () => {
    const contents = await source("src/app/(app)/today/today-route-view.tsx");
    expect(contents).toContain("routines.listByDate(user.id, today)");
    expect(contents).not.toContain("service.getToday");
  });

  it("splits Today into route-only AM and PM views without duplicating runtime data loading", async () => {
    const root = await source("src/app/(app)/today/page.tsx");
    const am = await source("src/app/(app)/today/am/page.tsx");
    const pm = await source("src/app/(app)/today/pm/page.tsx");
    expect(root).toContain('redirect("/today/am")');
    expect(am).toContain('<TodayRouteView period="am" />');
    expect(pm).toContain('<TodayRouteView period="pm" />');
    expect(am).not.toContain("createRoutineRepository");
    expect(pm).not.toContain("createRoutineRepository");
  });

  it("does not block Inventory on a full Products list", async () => {
    const page = await source("src/app/(app)/inventory/page.tsx");
    const manager = await source("src/features/inventory/inventory-manager.tsx");
    expect(page).not.toContain("listProducts(");
    expect(page).not.toContain("initialProducts");
    expect(manager).not.toContain("initialProducts");
  });

  it("keeps weather in the active sidebar entry", async () => {
    const layout = await source("src/app/(app)/layout.tsx");
    const sidebarEnvironment = await source("src/features/weather/sidebar-environment-entry.tsx");
    expect(layout).not.toContain("EnvironmentSummary");
    expect(layout).not.toContain("AsyncEnvironmentSummary");
    expect(layout).toContain("<SidebarEnvironmentEntry");
    expect(sidebarEnvironment).toContain("湿度 ${humidity}%");
    expect(layout).toContain("uvIndex={shell.weather?.uv_index ?? null}");
    expect(sidebarEnvironment).toContain("`UV ${uvIndex}`");
    expect(sidebarEnvironment).toContain("<WeatherLocationSettings");
  });

  it("groups profile and check-in beneath the Skin sidebar heading", async () => {
    const layout = await source("src/app/(app)/layout.tsx");
    const navigation = await source("src/components/primary-navigation.tsx");
    expect(navigation).toContain(">皮肤</p>");
    expect(navigation).toContain('href="/profile"');
    expect(navigation).toContain("长期档案");
    expect(navigation).toContain('href="/check-in"');
    expect(navigation).toContain("今日状态");
    expect(navigation).toContain('href="/preferences"');
    expect(navigation).toContain("护理偏好");
    expect(navigation).toContain(">今日方案</span>");
    expect(navigation).not.toContain('href="/today"');
    expect(navigation).toContain('href="/today/am"');
    expect(navigation).toContain('href="/today/pm"');
    expect(navigation).toContain("AM 早间方案");
    expect(navigation).toContain("PM 晚间方案");
    expect(navigation).toContain("我的资产");
    expect(layout).toContain("lg:grid-cols-[15.5rem_minmax(0,1fr)]");
  });

  it("uses a bounded full-height Home conversation workspace", async () => {
    const page = await source("src/app/(app)/app/page.tsx");
    const conversation = await source("src/features/skin-conversation/skin-conversation.tsx");
    const chatShell = await source("src/features/chat/chat-shell.tsx");
    expect(page).toContain("lg:h-svh");
    expect(page).toContain("max-w-[940px]");
    expect(page).toContain("lg:ml-20");
    expect(page).toContain("overflow-hidden");
    expect(page).toContain('className="flex min-h-0 flex-1 flex-col" id="daily-skin"');
    expect(chatShell).toContain('aria-label="Conversation messages"');
    expect(chatShell).toContain("overflow-y-auto");
    expect(chatShell).toContain("shrink-0");
    expect(conversation).toContain('onClick={restart}');
    expect(conversation).not.toContain('status !== "saved" ? <Button className="h-9 gap-2');
  });
});
