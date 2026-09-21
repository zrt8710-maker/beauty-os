import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({ getRoutineRequestContext: vi.fn() }));

vi.mock("@/server/routines/get-routine-request-context", () => ({
  getRoutineRequestContext: mocks.getRoutineRequestContext,
}));

import { GET as getRoutine } from "@/app/api/v1/routines/[id]/route";
import { POST as generateRoutine } from "@/app/api/v1/routines/generate/route";
import { RoutineRegenerationFailedError } from "@/server/services/rule-engine-service";

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

  it("拒绝包含其他用户字段的生成请求", async () => {
    const response = await generateRoutine(jsonRequest({ period: "am", user_id: "user-b" }));
    expect(response.status).toBe(400);
    expect(service.generate).not.toHaveBeenCalled();
  });

  it("returns the persisted routine in a 201 success envelope", async () => {
    const saved = { id: routineId, period: "pm", steps: [] };
    service.generate.mockResolvedValueOnce(saved);

    const response = await generateRoutine(jsonRequest({ period: "pm" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: saved, generationResult: "generated" });
  });

  it("forwards explicit regeneration intent without requiring it for ordinary generation", async () => {
    await generateRoutine(jsonRequest({ period: "pm", forceRegenerate: true }));

    expect(service.generate).toHaveBeenCalledWith("user-a", {
      period: "pm",
      forceRegenerate: true,
    }, expect.any(Function));
  });

  it("returns retained_after_failure when the service keeps an existing safe routine", async () => {
    service.generate.mockImplementationOnce(async (_userId: string, _input: unknown, onResult: (result: "retained_after_failure", explanation?: string) => void) => {
      onResult("retained_after_failure", "旧方案重新检查后仍可安全使用。");
      return { id: routineId, steps: [] };
    });
    const response = await generateRoutine(jsonRequest({ period: "pm", forceRegenerate: true }));
    expect(await response.json()).toEqual({ data: { id: routineId, steps: [] }, generationResult: "retained_after_failure", generationExplanation: "旧方案重新检查后仍可安全使用。" });
  });

  it("returns reused with its consumer-safe validation explanation", async () => {
    service.generate.mockImplementationOnce(async (_userId: string, _input: unknown, onResult: (result: "reused", explanation?: string) => void) => {
      onResult("reused", "今天的环境虽有小幅变化，但当前搭配仍能覆盖主要需要。");
      return { id: routineId, steps: [] };
    });
    const response = await generateRoutine(jsonRequest({ period: "pm" }));
    expect(await response.json()).toEqual({
      data: { id: routineId, steps: [] },
      generationResult: "reused",
      generationExplanation: "今天的环境虽有小幅变化，但当前搭配仍能覆盖主要需要。",
    });
  });

  it("returns deterministic_fallback distinctly from a normal Planner result", async () => {
    service.generate.mockImplementationOnce(async (_userId: string, _input: unknown, onResult: (result: "deterministic_fallback") => void) => {
      onResult("deterministic_fallback");
      return { id: routineId, steps: [] };
    });
    const response = await generateRoutine(jsonRequest({ period: "pm" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: routineId, steps: [] }, generationResult: "deterministic_fallback" });
  });

  it("不将服务端 ZodError 误报为请求参数错误", async () => {
    service.generate.mockRejectedValueOnce(new ZodError([]));

    const response = await generateRoutine(jsonRequest({ period: "am" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("ROUTINE_GENERATE_FAILED");
  });

  it("does not report a failed regeneration as a newly created routine", async () => {
    service.generate.mockRejectedValueOnce(new RoutineRegenerationFailedError());

    const response = await generateRoutine(jsonRequest({ period: "pm" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CARE_PLANNER_REGENERATION_FAILED");
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
