import "server-only";

import { usageFeedbackConversationRequestSchema, usageFeedbackConversationResultSchema, usageFeedbackDraftSchema, type UsageFeedbackDraft } from "@/schemas/usage-feedback-conversation";
import type { RoutineRolePreference } from "@/schemas/usage";

export type UsageFeedbackMessageInput = {
  conversationId: string;
  messageId: string;
  completionStatus: "completed" | "partial" | "skipped";
  notes: string | null;
  routineRolePreferences?: RoutineRolePreference[];
  products: Array<{
    owned_product_id: string;
    operation: "add" | "amend" | "retract";
    rating: number | null;
    reaction_level: number | null;
    reaction_tags: string[];
    texture_feedback: string | null;
    notes: string | null;
  }>;
};

export type UsageFeedbackConversationProvider = {
  converse(input: { message: string; activeTurnContext: string[]; routine: { period: "am" | "pm"; steps: Array<{ ownedProductId: string; productName: string; stepOrder: number }> }; personalMemoryContext: string[] }): Promise<unknown>;
};

export function createUsageFeedbackConversationService(provider: UsageFeedbackConversationProvider) {
  return {
    async converse(input: unknown, context: { routine: { period: "am" | "pm"; steps: Array<{ ownedProductId: string; productName: string; stepOrder: number }> }; personalMemoryContext: string[] }) {
      const request = usageFeedbackConversationRequestSchema.parse(input);
      const output = await provider.converse({ message: request.message, activeTurnContext: request.active_turn_context, routine: context.routine, personalMemoryContext: context.personalMemoryContext });
      return usageFeedbackConversationResultSchema.parse(output);
    },
  };
}

export function mapUsageFeedbackMessage(draftInput: unknown, input: { conversationId: string; messageId: string }, routineProductIds: ReadonlySet<string>): UsageFeedbackMessageInput {
  const draft = usageFeedbackDraftSchema.parse(draftInput);
  return {
    conversationId: input.conversationId,
    messageId: input.messageId,
    completionStatus: draft.completion_status,
    notes: draft.overall_notes,
    routineRolePreferences: draft.routine_role_preferences,
    products: feedbackProducts(draft, routineProductIds),
  };
}

function feedbackProducts(draft: UsageFeedbackDraft, routineProductIds: ReadonlySet<string>): UsageFeedbackMessageInput["products"] {
  const products: UsageFeedbackMessageInput["products"] = [];
  for (const product of draft.products) {
      if (!routineProductIds.has(product.owned_product_id)) continue;
      if (product.operation === "retract") { products.push({ owned_product_id: product.owned_product_id, operation: "retract", rating: null, reaction_level: null, reaction_tags: [], texture_feedback: null, notes: null }); continue; }
      const reactionLevel = product.reaction_severity === "strong" ? 3 : product.reaction_severity === "mild" ? 2 : null;
      const rating = ratingFor(product.sentiment, product.texture_tags.includes("comfortable"));
      if (rating === null && reactionLevel === null && product.texture_tags.length === 0 && product.reaction_tags.length === 0 && !product.notes) continue;
      products.push({ owned_product_id: product.owned_product_id, operation: product.operation, rating, reaction_level: reactionLevel, reaction_tags: product.reaction_tags, texture_feedback: product.texture_tags.join(",") || null, notes: product.notes });
  }
  return products;
}

function ratingFor(sentiment: UsageFeedbackDraft["products"][number]["sentiment"], comfortable: boolean) {
  return sentiment === "positive_strong" ? 5 : sentiment === "positive_mild" ? 4 : sentiment === "neutral" ? 3 : sentiment === "dislike" ? 2 : sentiment === "discomfort" ? 1 : comfortable ? 4 : null;
}
