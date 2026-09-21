import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("protected layout mobile navigation", () => {
  it("在 375px 布局隐藏桌面侧边栏，并提供原生感底部导航与退出入口", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/(app)/layout.tsx"),
      "utf8",
    );

    expect(source).toContain("hidden h-svh flex-col border-r bg-sidebar lg:flex");
    expect(source).toContain('className="border-b border-sidebar-border bg-sidebar lg:hidden"');
    expect(source).toContain("<PrimaryNavigation mobile />");
    expect(source).toContain('pb-[calc(4.5rem+env(safe-area-inset-bottom))]');
    expect(source).toContain(">退出</Button>");
    expect(source).not.toContain(">导航</summary>");
    expect(source).not.toContain("overflow-x-auto");
  });
});
