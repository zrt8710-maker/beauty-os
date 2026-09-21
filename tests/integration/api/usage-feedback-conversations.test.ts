import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUsageRequestContext: vi.fn(), provider: { converse: vi.fn() }, after: vi.fn() }));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});
vi.mock("@/server/usage/get-usage-request-context", () => ({ getUsageRequestContext: mocks.getUsageRequestContext }));
vi.mock("@/server/usage-feedback-conversation/volcengine-usage-feedback-conversation-provider", () => ({ createConfiguredVolcengineUsageFeedbackConversationProvider: () => mocks.provider }));

import { POST } from "@/app/api/v1/usage-feedback-conversations/route";

const routineId = "10000000-0000-4000-8000-000000000001";
const serumId = "10000000-0000-4000-8000-000000000002";
const creamId = "10000000-0000-4000-8000-000000000003";
const conversationId = "10000000-0000-4000-8000-000000000004";
const messageId = "10000000-0000-4000-8000-000000000005";

describe("usage feedback conversation API", () => {
  const routines = { findById: vi.fn() };
  const service = { recordFeedbackMessage: vi.fn() };
  const memory = { retrieveUsageFeedback: vi.fn(), commitFeedback: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUsageRequestContext.mockResolvedValue({ user: { id: "user-a" }, routines, service, memory });
    routines.findById.mockResolvedValue(routine());
    memory.retrieveUsageFeedback.mockResolvedValue([]);
    memory.commitFeedback.mockResolvedValue(undefined);
    mocks.provider.converse.mockResolvedValue({ reply: "听起来这次整体还不错。", draft: draft() });
    service.recordFeedbackMessage.mockResolvedValue({ applied: true, history: history([product(serumId, { texture_feedback: "too_sticky", notes: "有点黏" }), product(creamId, { notes: "舒服" })]) });
  });

  it("returns a consumer-safe summary from the persisted final history for multiple products", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ saved: true, recorded_summary: { outcome: "routine_used", products: [{ product_name: "品牌 · 精华", observations: expect.arrayContaining(["偏黏", "有点黏"]) }, { product_name: "品牌 · 面霜", observations: ["舒服"] }] } });
    expect(JSON.stringify(body.data)).not.toMatch(/owned_product_id|reaction_level|confidence|provider|draft/i);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(memory.commitFeedback).not.toHaveBeenCalled();
  });

  it("returns the same current durable summary for an idempotent retry", async () => {
    service.recordFeedbackMessage.mockResolvedValueOnce({ applied: false, history: history([product(serumId, { notes: "舒服" })]) });

    const response = await POST(request());
    const body = await response.json();

    expect(body.data.recorded_summary.products).toEqual([expect.objectContaining({ product_name: "品牌 · 精华" })]);
    expect(memory.commitFeedback).not.toHaveBeenCalled();
  });

  it("does not claim a saved summary when durable persistence fails", async () => {
    service.recordFeedbackMessage.mockRejectedValueOnce(new Error("write failed"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("USAGE_FEEDBACK_AUTO_PERSIST_FAILED");
    expect(body.data).toBeUndefined();
  });

  it("does not return a summary when the conversation has no durable feedback draft", async () => {
    mocks.provider.converse.mockResolvedValueOnce({ reply: "你可以再说说具体是哪一支。", draft: null });

    const response = await POST(request());
    expect(await response.json()).toEqual({ data: { reply: "你可以再说说具体是哪一支。", saved: false, recorded_summary: null } });
    expect(service.recordFeedbackMessage).not.toHaveBeenCalled();
  });

  it("persists an AM cleanser preference without binding it to an owned product", async () => {
    mocks.provider.converse.mockResolvedValueOnce({ reply: "早上的安排可以更贴近你的习惯。", draft: {
      completion_status: "partial", overall_notes: null, products: [],
      routine_role_preferences: [{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" }],
    } });
    routines.findById.mockResolvedValueOnce({ ...routine(), period: "am" });
    service.recordFeedbackMessage.mockResolvedValueOnce({ applied: true, history: { ...history([]), period: "am", routine_role_preferences: [{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" }] } });

    const response = await POST(request("我早上不喜欢用洗面奶"));

    expect(response.status).toBe(200);
    expect(service.recordFeedbackMessage).toHaveBeenCalledWith("user-a", routineId, expect.objectContaining({
      products: [],
      routineRolePreferences: [{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" }],
    }), expect.anything());
  });
});

function request(message = "精华有点黏，面霜很舒服") { return new Request("http://localhost/api/v1/usage-feedback-conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routine_id: routineId, conversation_id: conversationId, message_id: messageId, message, active_turn_context: [] }) }); }
function routine() { return { id: routineId, period: "pm", steps: [{ owned_product_id: serumId, owned_product: { product: { brand_name: "品牌", product_name: "精华" } } }, { owned_product_id: creamId, owned_product: { product: { brand_name: "品牌", product_name: "面霜" } } }] }; }
function draft() { return { completion_status: "partial", overall_notes: null, products: [{ owned_product_id: serumId, operation: "add", used_status: "used", sentiment: null, texture_tags: ["too_sticky"], reaction_severity: null, reaction_tags: [], notes: "有点黏" }] }; }
function history(products: Array<Record<string, unknown>>) { return { id: "10000000-0000-4000-8000-000000000010", routine_id: routineId, used_date: "2026-09-12", period: "pm", completion_status: "partial", overall_rating: null, skin_reaction_level: null, notes: null, created_at: "2026-09-12T12:00:00.000Z", products }; }
function product(ownedProductId: string, input: Record<string, unknown> = {}) { return { id: ownedProductId.replace("00000000000", "00000000001"), usage_history_id: "10000000-0000-4000-8000-000000000010", owned_product_id: ownedProductId, rating: null, reaction_level: null, reaction_tags: [], texture_feedback: null, notes: null, created_at: "2026-09-12T12:00:00.000Z", ...input }; }
