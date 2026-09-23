import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { createSupabasePersonalMemoryService } from "@/server/services/supabase-personal-memory-service";

function memoryClient() {
  const rows = new Map<string, Array<{ content: string; fingerprint: string }>>();
  const upsert = vi.fn(async (entries: Array<{ user_id: string; content: string; fingerprint: string }>) => {
    for (const entry of entries) {
      const current = rows.get(entry.user_id) ?? [];
      if (!current.some((row) => row.fingerprint === entry.fingerprint)) current.push(entry);
      rows.set(entry.user_id, current);
    }
    return { error: null };
  });
  const from = vi.fn(() => ({
    upsert,
    select: () => ({
      eq: (_column: string, userId: string) => ({
        order: () => ({ limit: async () => ({ data: rows.get(userId) ?? [], error: null }) }),
      }),
    }),
  }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, upsert };
}

describe("Supabase personal memory tenant boundary", () => {
  it("commits only explicit durable user preferences and keeps users separate", async () => {
    const { client, upsert } = memoryClient();
    const alice = createSupabasePersonalMemoryService(client, "alice");
    const bob = createSupabasePersonalMemoryService(client, "bob");
    await alice.commitDailySkinTranscript([
      { role: "user", content: "我通常偏好轻薄的保湿产品。" },
      { role: "user", content: "今天有点痘。" },
      { role: "assistant", content: "你喜欢厚重质地。" },
    ]);
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ user_id: "alice", content: "我通常偏好轻薄的保湿产品。" })]);
    expect(await alice.retrieveToday({ period: "pm", concerns: [], baseline: [], priorities: ["保湿"] })).toEqual(["我通常偏好轻薄的保湿产品。"]);
    expect(await bob.retrieveToday({ period: "pm", concerns: [], baseline: [], priorities: ["保湿"] })).toEqual([]);
  });

  it("ignores memory database failures without blocking the caller", async () => {
    const client = { from: () => ({
      upsert: async () => ({ error: new Error("unavailable") }),
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: new Error("unavailable") }) }) }) }),
    }) } as unknown as SupabaseClient<Database>;
    const memory = createSupabasePersonalMemoryService(client, "alice");
    await expect(memory.commitDailySkinTranscript([{ role: "user", content: "我偏好轻薄保湿。" }])).resolves.toBeUndefined();
    await expect(memory.retrieveDailySkin({ message: "保湿", activeTurnContext: [] })).resolves.toEqual([]);
  });
});
