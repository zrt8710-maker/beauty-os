import { beforeEach, describe, expect, it, vi } from "vitest";

import { routineGenerateSchema } from "@/schemas/routine";

const mocks = vi.hoisted(() => ({ getRoutineRequestContext: vi.fn() }));

vi.mock("@/server/routines/get-routine-request-context", () => ({
  getRoutineRequestContext: mocks.getRoutineRequestContext,
}));

import { GET as getRoutine } from "@/app/api/v1/routines/[id]/route";
import { POST as generateRoutine } from "@/app/api/v1/routines/generate/route";

const routineId = "70000000-0000-4000-8000-000000000001";

describe("routine API", () => {
  const service = {
    getToday: vi.fn(),
    getRoutine: vi.fn(),
    generate: vi.fn(),
    saveFeedback: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRoutineRequestContext.mockResolvedValue({
      user: { id: "user-a" },
      service,
    });
    service.generate.mockResolvedValue({ id: routineId, steps: [] });
    service.getRoutine.mockResolvedValue({ id: routineId, steps: [] });
  });

  it("生成接口只使用当前 session 用户", async () => {
    service.generate.mockRejectedValueOnce(
      routineGenerateSchema.safeParse({ period: "am", user_id: "user-b" }).error,
    );
    const response = await generateRoutine(jsonRequest({ period: "am", user_id: "user-b" }));
    expect(response.status).toBe(400);
    expect(service.generate).toHaveBeenCalledWith("user-a", expect.anything());
  });

  it("读取指定方案时只向 service 传当前用户", async () => {
    const response = await getRoutine(new Request("http://localhost"), {
      params: Promise.resolve({ id: routineId }),
    });
    expect(response.status).toBe(200);
    expect(service.getRoutine).toHaveBeenCalledWith("user-a", routineId);
  });

  it("未登录不能生成方案", async () => {
    mocks.getRoutineRequestContext.mockResolvedValue(null);
    const response = await generateRoutine(jsonRequest({ period: "am" }));
    expect(response.status).toBe(401);
    expect(service.generate).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/v1/routines/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
