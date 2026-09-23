import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { UsageHistory } from "@/schemas/usage";
import type { PersonalMemoryService } from "@/server/services/personal-memory-service";

const MAX_CONTEXT = 5;
const MAX_CANDIDATES = 40;
const PREFERENCE_PATTERN = /喜欢|不喜欢|偏好|习惯|倾向|过敏|耐受|避免|不想|不愿|不要|尽量|一直|通常|每次|经常/u;
const CURRENT_STATE_PATTERN = /今天|现在|刚刚|这次|昨天|明天/u;
const TOPIC_PATTERN = /出油|油皮|干燥|干皮|痘|泛红|敏感|刺痛|清洁|洁面|保湿|防晒|质地|厚重|黏|轻薄|步骤|局部|卸妆|美白|斑/u;

/** Authenticated Supabase client + RLS is the tenant boundary. Never use a service-role client here. */
export function createSupabasePersonalMemoryService(
  supabase: SupabaseClient<Database>,
  userId: string,
): PersonalMemoryService {
  async function retrieve(query: string): Promise<string[]> {
    try {
      const { data, error } = await supabase.from("personal_memories")
        .select("content, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_CANDIDATES);
      if (error) throw error;
      const tokens = [...new Set((query.match(/出油|油皮|干燥|干皮|痘|泛红|敏感|刺痛|清洁|洁面|保湿|防晒|质地|厚重|黏|轻薄|步骤|局部|卸妆|美白|斑/gu) ?? []))];
      return (data ?? [])
        .map((row, index) => ({ content: row.content, index, score: tokens.filter((token) => row.content.includes(token)).length }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, MAX_CONTEXT)
        .map((row) => row.content);
    } catch {
      return [];
    }
  }

  async function commit(source: "daily_skin" | "feedback", contents: string[]): Promise<void> {
    try {
      const rows = [...new Set(contents.map((value) => value.trim().slice(0, 500)).filter(Boolean))]
        .slice(-20)
        .map((content) => ({
          user_id: userId,
          source,
          content,
          fingerprint: createHash("sha256").update(`${source}:${content}`).digest("hex"),
        }));
      if (!rows.length) return;
      const { error } = await supabase.from("personal_memories").upsert(rows, {
        onConflict: "user_id,fingerprint", ignoreDuplicates: true,
      });
      if (error) throw error;
    } catch {
      // Memory is best effort; a write failure cannot fail an already-saved skin record.
    }
  }

  return {
    retrieveDailySkin(input) { return retrieve([input.message, ...input.activeTurnContext].join(" ")); },
    retrieveToday(input) { return retrieve([...input.concerns, ...input.baseline, ...input.priorities].join(" ")); },
    retrieveUsageFeedback() { return retrieve("护理偏好 质地 步骤 产品体验"); },
    commitDailySkinTranscript(transcript) {
      // Keep only the user's explicit, durable preferences. Today's symptoms and
      // assistant inferences remain in their original daily records, not long-term memory.
      return commit("daily_skin", transcript
        .filter((message) => message.role === "user")
        .map((message) => message.content.trim())
        .filter((content) => PREFERENCE_PATTERN.test(content) && TOPIC_PATTERN.test(content) && !CURRENT_STATE_PATTERN.test(content)));
    },
    commitFeedback(input) {
      const contents = [
        ...input.history.products.map((product) => feedbackMemory(product, input.productNames.get(product.owned_product_id) ?? "已选产品")),
        ...input.history.routine_role_preferences.map((preference) => `${preference.period === "am" ? "早间" : "晚间"}护理偏好：${preference.polarity === "avoid" ? "倾向跳过" : "倾向保留"}${preference.routine_role}步骤。`),
      ];
      return commit("feedback", contents);
    },
  };
}

function feedbackMemory(product: UsageHistory["products"][number], name: string): string {
  const rating = product.rating === null ? "" : product.rating >= 4 ? "使用体验较好" : product.rating <= 2 ? "使用体验较差" : "使用体验一般";
  const details = [rating, product.texture_feedback, ...product.reaction_tags, product.reaction_level !== null && product.reaction_level >= 2 ? "有不适" : ""]
    .filter(Boolean).join("、");
  return details ? `产品体验：${name}：${details}。` : "";
}
