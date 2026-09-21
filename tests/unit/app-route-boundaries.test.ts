import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("core route loading and error boundaries", () => {
  it("covers Home, Inventory, Daily Skin, Today, Profile, and Purchase Advisor", async () => {
    for (const route of ["app", "inventory", "check-in", "today", "profile", "purchase-advisor"]) {
      await access(path.join(process.cwd(), "src/app/(app)", route, "loading.tsx"));
    }
    for (const route of ["app", "inventory", "check-in", "today", "purchase-advisor"]) {
      await access(path.join(process.cwd(), "src/app/(app)", route, "error.tsx"));
    }
    const errorSource = await readFile(path.join(process.cwd(), "src/components/app-route-error.tsx"), "utf8");
    expect(errorSource).toContain("重新加载");
    expect(errorSource).toContain("返回首页");
    expect(errorSource).not.toContain("error.message");
  });

  it("uses restrained ambient texture markers on content pages and a quieter Inventory variant", async () => {
    for (const [route, variant] of [["today/today-route-view.tsx", "today"], ["profile/page.tsx", "profile"], ["check-in/page.tsx", "checkin"], ["preferences/page.tsx", "preferences"], ["purchase-advisor/page.tsx", "purchase"]]) {
      const source = await readFile(path.join(process.cwd(), "src/app/(app)", route), "utf8");
      expect(source).toContain("beauty-ambient-page");
      expect(source).toContain(`beauty-ambient-${variant}`);
    }
    const inventorySource = await readFile(path.join(process.cwd(), "src/app/(app)/inventory/page.tsx"), "utf8");
    expect(inventorySource).toContain("beauty-ambient-inventory");
    const globals = await readFile(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(globals).toContain("var(--landscape-veil-top)");
    expect(globals).toContain("var(--landscape-veil-bottom)");
    expect(globals).toContain(".beauty-ambient-page { position: relative; }");
  });
});
