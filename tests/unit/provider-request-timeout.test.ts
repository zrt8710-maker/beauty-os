import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { providerRequestSignal } from "@/server/integrations/provider-request-timeout";

describe("provider request timeout", () => {
  it("aborts a stalled provider request", async () => {
    const signal = providerRequestSignal(1);
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    expect(signal.aborted).toBe(true);
  });

  it("is applied to every release-critical provider fetch", async () => {
    const files = [
      "src/server/daily-skin-report/volcengine-professional-daily-observation-provider.ts",
      "src/server/weekly-skin-summary/volcengine-weekly-skin-narration-provider.ts",
      "src/server/services/volcengine-today-user-narrative-provider.ts",
      "src/server/usage-feedback-conversation/volcengine-usage-feedback-conversation-provider.ts",
    ];
    for (const file of files) {
      const source = await readFile(path.join(process.cwd(), file), "utf8");
      expect(source, file).toContain("signal: providerRequestSignal(options.timeoutMs)");
    }

    const todayPlanner = await readFile(path.join(
      process.cwd(),
      "src/server/services/volcengine-today-care-planner-provider.ts",
    ), "utf8");
    expect(todayPlanner).toContain("const TODAY_CARE_PLANNER_TIMEOUT_MS = 75_000");
    expect(todayPlanner).toContain("signal: providerRequestSignal(options.timeoutMs ?? TODAY_CARE_PLANNER_TIMEOUT_MS)");
  });
});
