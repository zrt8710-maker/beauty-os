import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Daily Skin adjustment presentation", () => {
  it("renders localized concern and area labels while retaining enum values", async () => {
    const source = await readFile(path.join(process.cwd(), "src/features/skin-conversation/skin-conversation.tsx"), "utf8");
    expect(source).toContain("value={kind}>{concernLabels[kind]}</option>");
    expect(source).toContain("value={area}>{areaLabels[area]}</option>");
    expect(source).not.toContain("value={kind}>{kind}</option>");
    expect(source).not.toContain("value={area}>{area}</option>");
  });
});
