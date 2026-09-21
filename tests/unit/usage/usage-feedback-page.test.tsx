import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), byId: vi.fn(), byDate: vi.fn(), convert: vi.fn() }));
vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/server/app-shell/app-shell-context", () => ({ getProfileContext: async () => ({ profile: { timezone: "Asia/Shanghai" } }) }));
vi.mock("@/server/repositories/routine-repository", () => ({ createRoutineRepository: () => ({ findById: mocks.byId, findByDate: mocks.byDate }) }));
vi.mock("@/server/services/rule-engine-service", () => ({ toRoutine: mocks.convert }));
vi.mock("@/features/usage-feedback-conversation/usage-feedback-conversation", () => ({ UsageFeedbackConversation: () => null }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import UsageFeedbackPage from "@/app/(app)/usage-feedback/page";

describe("usage feedback page reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: "user-a" });
  });

  it("reads an explicit routine once, scoped to the current user, and passes the converted result", async () => {
    const row = { id: "routine-a", steps: [] };
    const routine = { ...row, period: "pm" };
    mocks.byId.mockResolvedValue(row);
    mocks.convert.mockReturnValue(routine);
    const page = await UsageFeedbackPage({ searchParams: Promise.resolve({ routineId: row.id }) });
    expect(mocks.byId).toHaveBeenCalledExactlyOnceWith("user-a", row.id);
    expect(mocks.byDate).not.toHaveBeenCalled();
    expect(mocks.convert).toHaveBeenCalledExactlyOnceWith(row);
    expect(page.props.routine).toBe(routine);
  });

  it("uses the requested period without fetching the same routine again by id", async () => {
    const row = { id: "routine-a", steps: [] };
    mocks.byDate.mockResolvedValue(row);
    mocks.convert.mockReturnValue(row);
    await UsageFeedbackPage({ searchParams: Promise.resolve({ period: "am" }) });
    expect(mocks.byDate).toHaveBeenCalledExactlyOnceWith("user-a", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), "am");
    expect(mocks.byId).not.toHaveBeenCalled();
  });

  it("keeps the empty state for missing or inaccessible routines", async () => {
    mocks.byId.mockResolvedValue(null);
    const page = await UsageFeedbackPage({ searchParams: Promise.resolve({ routineId: "other-user-routine" }) });
    expect(page.type).toBe("main");
    expect(mocks.byId).toHaveBeenCalledExactlyOnceWith("user-a", "other-user-routine");
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated requests before querying routines", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(UsageFeedbackPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
    expect(mocks.byId).not.toHaveBeenCalled();
    expect(mocks.byDate).not.toHaveBeenCalled();
  });
});
