import { describe, expect, it, vi } from "vitest";

import { createOpenVikingClient } from "@/server/openviking/openviking-client";
import { createPersonalMemoryService } from "@/server/services/personal-memory-service";

describe("OpenViking single-user memory boundary", () => {
  it("uses only the official Bearer headers and memory-only find scope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { memories: [{ abstract: "偏好轻薄、不黏的晚间保湿。", score: 0.92, match_reason: "texture" }], resources: [{ abstract: "must not pass" }] },
    }), { status: 200 }));
    const client = createOpenVikingClient({ baseUrl: "https://memory.example.test/", apiKey: "secret", fetchImpl: fetchImpl as typeof fetch });

    await expect(client.findMemories({ query: "晚间护理偏好", limit: 5, scoreThreshold: 0.2 })).resolves.toEqual([
      { abstract: "偏好轻薄、不黏的晚间保湿。", score: 0.92, matchReason: "texture" },
    ]);

    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://memory.example.test/api/v1/search/find");
    expect(request.headers).toMatchObject({ Authorization: "Bearer secret", "Content-Type": "application/json" });
    expect(request.headers).not.toHaveProperty("X-OpenViking-Agent");
    expect(JSON.parse(request.body)).toEqual({ query: "晚间护理偏好", context_type: "memory", target_uri: "viking://~/memories", limit: 5, score_threshold: 0.2 });
  });

  it("retrieves compact soft context and commits one full Daily Skin transcript", async () => {
    const client = {
      findMemories: vi.fn().mockResolvedValue([{ abstract: "习惯少步骤，偏好轻薄。", score: 0.8, matchReason: null }]),
      createSession: vi.fn().mockResolvedValue("session-1"),
      addMessage: vi.fn().mockResolvedValue(undefined),
      commitSession: vi.fn().mockResolvedValue(undefined),
    };
    const service = createPersonalMemoryService(client);

    await expect(service.retrieveToday({ period: "pm", concerns: ["blemishes"], baseline: [], priorities: ["optional_treatment"] })).resolves.toEqual(["习惯少步骤，偏好轻薄。"]);
    await service.commitDailySkinTranscript([
      { role: "user", content: "额头有新痘。" },
      { role: "assistant", content: "我会按你说的整理。" },
    ]);

    expect(client.findMemories).toHaveBeenCalledOnce();
    expect(client.addMessage).toHaveBeenNthCalledWith(1, "session-1", { role: "user", content: "额头有新痘。" });
    expect(client.addMessage).toHaveBeenNthCalledWith(2, "session-1", { role: "assistant", content: "我会按你说的整理。" });
    expect(client.commitSession).toHaveBeenCalledWith("session-1");
  });

  it("makes OpenViking failure non-blocking", async () => {
    const service = createPersonalMemoryService({
      findMemories: vi.fn().mockRejectedValue(new Error("unavailable")),
      createSession: vi.fn().mockRejectedValue(new Error("unavailable")),
      addMessage: vi.fn(), commitSession: vi.fn(),
    });
    await expect(service.retrieveDailySkin({ message: "今天有点油", activeTurnContext: [] })).resolves.toEqual([]);
    await expect(service.commitDailySkinTranscript([{ role: "user", content: "今天有点油" }])).resolves.toBeUndefined();
  });

  it("keeps routine-role preference scope separate from product experience", async () => {
    const client = {
      findMemories: vi.fn(), createSession: vi.fn().mockResolvedValue("session-1"),
      addMessage: vi.fn().mockResolvedValue(undefined), commitSession: vi.fn().mockResolvedValue(undefined),
    };
    const service = createPersonalMemoryService(client);
    await service.commitFeedback({
      history: {
        id: "10000000-0000-4000-8000-000000000010", routine_id: "10000000-0000-4000-8000-000000000011",
        used_date: "2026-09-17", period: "am", completion_status: "partial", overall_rating: null,
        skin_reaction_level: null, notes: null, created_at: "2026-09-17T00:00:00.000Z",
        routine_role_preferences: [{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" }],
        products: [],
      },
      productNames: new Map(),
    });

    expect(client.addMessage).toHaveBeenCalledWith("session-1", {
      role: "user",
      content: "护理偏好：早间通常倾向跳过洁面步骤。",
    });
    expect(JSON.stringify(client.addMessage.mock.calls)).not.toContain("不喜欢这款");
  });
});
