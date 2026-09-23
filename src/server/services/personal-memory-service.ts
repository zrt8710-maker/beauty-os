import "server-only";

import type { UsageHistory } from "@/schemas/usage";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { createConfiguredOpenVikingClient, type OpenVikingClient } from "@/server/openviking/openviking-client";
import { createSupabasePersonalMemoryService } from "@/server/services/supabase-personal-memory-service";

const MAX_MEMORY_CONTEXT = 5;

export type PersonalMemoryService = {
  retrieveDailySkin(input: { message: string; activeTurnContext: string[] }): Promise<string[]>;
  retrieveToday(input: { period: "am" | "pm"; concerns: string[]; baseline: string[]; priorities: string[] }): Promise<string[]>;
  retrieveUsageFeedback(): Promise<string[]>;
  commitDailySkinTranscript(transcript: Array<{ role: "user" | "assistant"; content: string }>): Promise<void>;
  commitFeedback(input: { history: UsageHistory; productNames: Map<string, string> }): Promise<void>;
};

export function createConfiguredPersonalMemoryService(context?: { supabase: SupabaseClient<Database>; userId: string }): PersonalMemoryService {
  if (context) return createSupabasePersonalMemoryService(context.supabase, context.userId);
  return createPersonalMemoryService(createConfiguredOpenVikingClient());
}

export function createPersonalMemoryService(client: OpenVikingClient | null): PersonalMemoryService {
  async function retrieve(stage: "daily_skin" | "today" | "usage_feedback", query: string) {
    const startedAt = Date.now();
    let memoryCount = 0;
    let status = "disabled";
    try {
      if (!client) return [];
      const memories = await client.findMemories({ query, limit: MAX_MEMORY_CONTEXT, scoreThreshold: 0.2 });
      memoryCount = memories.length;
      status = "success";
      return memories.slice(0, MAX_MEMORY_CONTEXT).map((memory) => memory.abstract);
    } catch {
      status = "failed";
      return [];
    } finally {
      log(`memory_retrieval_${stage}`, startedAt, { queryLength: query.length, memory_count: memoryCount, memory_retrieval_status: status });
    }
  }

  async function commit(stage: "daily_skin" | "feedback", messages: Array<{ role: "user" | "assistant"; content: string }>) {
    const startedAt = Date.now();
    let status = "disabled";
    try {
      if (!client || messages.length === 0) return;
      const sessionId = await client.createSession();
      for (const message of messages) await client.addMessage(sessionId, message);
      await client.commitSession(sessionId);
      status = "success";
    } catch {
      // Memory is intentionally best-effort and never a business-flow dependency.
      status = "failed";
    } finally {
      log(`memory_write_${stage}`, startedAt, { memory_count: messages.length, memory_write_status: status });
    }
  }

  return {
    retrieveDailySkin(input) {
      const topics = relevantTopics([input.message, ...input.activeTurnContext].join(" "));
      return retrieve("daily_skin", `检索用户过去与皮肤状态表达、护理习惯、质地偏好、步骤复杂度偏好和局部护理相关的长期记忆。当前主题：${topics.join("、") || "日常皮肤状态"}。`);
    },
    retrieveToday(input) {
      const period = input.period === "am" ? "早间" : "晚间";
      return retrieve("today", `检索用户过去与当前${period}护理相关的长期偏好、护理习惯、质地倾向、步骤复杂度和局部护理方式。当前关注：${[...input.concerns, ...input.priorities, ...input.baseline].slice(0, 8).join("、") || "基础护理"}。`);
    },
    retrieveUsageFeedback() {
      return retrieve("usage_feedback", "检索用户过去与质地偏好、护理复杂度、局部护理方式和反复出现的真实使用体验相关的长期记忆。");
    },
    commitDailySkinTranscript(transcript) {
      return commit("daily_skin", transcript.filter((message) => message.content.trim()).slice(-30).map((message) => ({ ...message, content: message.content.trim().slice(0, 2000) })));
    },
    commitFeedback(input) {
      const messages = [
        ...input.history.products.map((product) => ({
          role: "user" as const,
          content: feedbackText(product, input.productNames.get(product.owned_product_id) ?? "已选产品"),
        })),
        ...input.history.routine_role_preferences.map((preference) => ({
          role: "user" as const,
          content: routineRolePreferenceText(preference),
        })),
      ];
      return commit("feedback", messages);
    },
  };
}

function feedbackText(product: UsageHistory["products"][number], name: string) {
  const experience = product.rating === null ? null : product.rating >= 4 ? "使用感受偏正面" : product.rating <= 2 ? "使用感受偏负面" : "使用感受一般";
  const parts = [experience, product.texture_feedback, ...product.reaction_tags, product.reaction_level !== null && product.reaction_level >= 2 ? "有不适" : null].filter((value): value is string => Boolean(value));
  return `产品体验：${name}：${parts.join("、") || "已提交反馈"}。`;
}

function routineRolePreferenceText(preference: UsageHistory["routine_role_preferences"][number]) {
  const period = preference.period === "am" ? "早间" : "晚间";
  const roleLabels: Record<UsageHistory["routine_role_preferences"][number]["routine_role"], string> = {
    remover: "卸妆",
    cleanser: "洁面",
    hydration: "补水",
    treatment: "功效护理",
    moisturizer: "保湿",
    sunscreen: "防晒",
  };
  const tendency = preference.polarity === "avoid" ? "通常倾向跳过" : "通常倾向保留";
  return `护理偏好：${period}${tendency}${roleLabels[preference.routine_role]}步骤。`;
}

function relevantTopics(text: string) {
  const pairs = [["出油", "出油"], ["油", "出油"], ["干", "干燥"], ["痘", "新痘"], ["泛红", "泛红"], ["厚", "厚重感"], ["黏", "厚重感"], ["局部", "局部护理"]] as const;
  return [...new Set(pairs.filter(([needle]) => text.includes(needle)).map(([, label]) => label))];
}

function log(stage: string, startedAt: number, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") console.info("[openviking-memory]", { stage, durationMs: Date.now() - startedAt, ...details });
}
