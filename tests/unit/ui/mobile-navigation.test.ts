import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("protected layout mobile navigation", () => {
  it("在 375px 布局保持退出入口可见，并允许主导航水平滚动", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/(app)/layout.tsx"),
      "utf8",
    );

    expect(source).toContain('className="lg:hidden"');
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain("shrink-0");
    expect(source).toContain("lg:overflow-visible");
    expect(source).toContain('className="hidden lg:block"');
  });
});
