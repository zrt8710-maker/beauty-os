import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(),
  getSupabaseAdminEnv: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createSupabaseClient,
}));

vi.mock("@/server/config/supabase-admin-env", () => ({
  getSupabaseAdminEnv: mocks.getSupabaseAdminEnv,
}));

import { createAdminClient } from "@/lib/supabase/admin";

describe("Supabase admin client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAdminEnv.mockReturnValue({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-sentinel",
    });
  });

  it("creates a trusted client with the service-role credential", () => {
    const client = { kind: "admin-client" };
    mocks.createSupabaseClient.mockReturnValue(client);

    expect(createAdminClient()).toBe(client);
    expect(mocks.createSupabaseClient).toHaveBeenCalledOnce();
    expect(mocks.createSupabaseClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-sentinel",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
  });

  it("does not configure cookies or a current-user session", () => {
    mocks.createSupabaseClient.mockReturnValue({});

    createAdminClient();

    const options = mocks.createSupabaseClient.mock.calls[0]?.[2];
    expect(options).not.toHaveProperty("cookies");
    expect(options).not.toHaveProperty("cookieOptions");
    expect(options).not.toHaveProperty("accessToken");
    expect(options).toMatchObject({
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  });
});
