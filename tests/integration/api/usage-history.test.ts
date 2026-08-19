import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsageRoutineNotFoundError } from "@/server/services/usage-service";
import { usageRecordInputSchema } from "@/schemas/usage";

const mocks = vi.hoisted(() => ({ getUsageRequestContext: vi.fn() }));
vi.mock("@/server/usage/get-usage-request-context", () => ({ getUsageRequestContext: mocks.getUsageRequestContext }));

import { POST as complete } from "@/app/api/v1/routines/[id]/complete/route";
import { POST as feedback } from "@/app/api/v1/routines/[id]/feedback/route";
import { GET as list } from "@/app/api/v1/usage-history/route";

const routineId = "20000000-0000-4000-8000-000000000001";
const history = { id: "40000000-0000-4000-8000-000000000001", routine_id: routineId, used_date: "2026-08-18", period: "am", completion_status: "completed", overall_rating: null, skin_reaction_level: null, notes: null, created_at: "2026-08-18T00:00:00.000Z", products: [] };

describe("usage history API", () => {
  const service = { recordRoutineUsage: vi.fn(), listUsageHistory: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUsageRequestContext.mockResolvedValue({ user: { id: "user-a" }, service });
    service.recordRoutineUsage.mockImplementation(async (_userId: string, _routineId: string, input: unknown) => {
      usageRecordInputSchema.parse(input);
      return history;
    });
    service.listUsageHistory.mockResolvedValue([history]);
  });

  it("完成方案只使用当前 session 用户", async () => {
    const response = await complete(request({ completion_status: "completed", products: [] }), { params: Promise.resolve({ id: routineId }) });
    expect(response.status).toBe(201);
    expect(service.recordRoutineUsage).toHaveBeenCalledWith("user-a", routineId, expect.anything());
  });

  it("非法输入与未登录请求被拒绝", async () => {
    const invalid = await feedback(request({ completion_status: "completed", products: [{ owned_product_id: "not-uuid" }] }), { params: Promise.resolve({ id: routineId }) });
    expect(invalid.status).toBe(400);
    mocks.getUsageRequestContext.mockResolvedValue(null);
    const unauthenticated = await list(new Request("http://localhost/api/v1/usage-history"));
    expect(unauthenticated.status).toBe(401);
  });

  it("其他用户的方案不能写入使用反馈", async () => {
    service.recordRoutineUsage.mockRejectedValueOnce(new UsageRoutineNotFoundError());
    const response = await feedback(request({ completion_status: "completed", products: [] }), { params: Promise.resolve({ id: routineId }) });
    expect(response.status).toBe(404);
  });
});

function request(body: unknown) { return new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
