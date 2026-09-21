import { describe, expect, it } from "vitest";

import { buildRecordedFeedbackSummary } from "@/features/usage-feedback-conversation/recorded-summary";
import type { UsageHistory } from "@/schemas/usage";

const routineId = "10000000-0000-4000-8000-000000000001";
const serumId = "10000000-0000-4000-8000-000000000002";
const creamId = "10000000-0000-4000-8000-000000000003";

describe("recorded feedback consumer summary", () => {
  it("shows only the final durable product facts, including a corrected amendment", () => {
    const summary = buildRecordedFeedbackSummary(history([
      product(serumId, { texture_feedback: "too_sticky", notes: "有点黏，但能接受" }),
      product(creamId, { reaction_tags: [], reaction_level: null, notes: "不是刺痛，只是凉凉的" }),
    ]), names());

    expect(summary.products).toEqual([
      expect.objectContaining({ product_name: "品牌 · 精华", observations: expect.arrayContaining(["偏黏", "有点黏，但能接受"]) }),
      expect.objectContaining({ product_name: "品牌 · 面霜", observations: expect.arrayContaining(["不是刺痛，只是凉凉的"]) }),
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/rating|reaction_level|confidence|provider|draft/i);
  });

  it("removes a retracted product because it is absent from the final durable record", () => {
    const summary = buildRecordedFeedbackSummary(history([product(serumId, { notes: "舒服" })]), names());

    expect(summary.products.map((item) => item.product_name)).toEqual(["品牌 · 精华"]);
    expect(summary.products.map((item) => item.product_name)).not.toContain("品牌 · 面霜");
  });

  it("keeps an actually skipped routine distinct without inventing a product result", () => {
    const summary = buildRecordedFeedbackSummary({ ...history([]), completion_status: "skipped", notes: "今天没来得及" }, names());

    expect(summary).toEqual({ outcome: "routine_skipped", products: [], overall_note: "今天没来得及" });
  });
});

function names() { return new Map([[serumId, "品牌 · 精华"], [creamId, "品牌 · 面霜"]]); }
function history(products: UsageHistory["products"]): UsageHistory { return { id: "10000000-0000-4000-8000-000000000010", routine_id: routineId, used_date: "2026-09-12", period: "pm", completion_status: "partial", overall_rating: null, skin_reaction_level: null, notes: null, routine_role_preferences: [], created_at: "2026-09-12T12:00:00.000Z", products }; }
function product(ownedProductId: string, input: Partial<UsageHistory["products"][number]> = {}): UsageHistory["products"][number] { return { id: ownedProductId.replace("00000000000", "00000000001"), usage_history_id: "10000000-0000-4000-8000-000000000010", owned_product_id: ownedProductId, rating: null, reaction_level: null, reaction_tags: [], texture_feedback: null, notes: null, created_at: "2026-09-12T12:00:00.000Z", ...input }; }
