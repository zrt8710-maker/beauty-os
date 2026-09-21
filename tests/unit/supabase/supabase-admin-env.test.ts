import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SupabaseAdminConfigurationError,
  getSupabaseAdminEnv,
} from "@/server/config/supabase-admin-env";

describe("Supabase admin environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the server URL and service-role key when both are configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-sentinel");

    expect(getSupabaseAdminEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-sentinel",
    });
  });

  it("fails clearly when the service-role key is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    expect(() => getSupabaseAdminEnv()).toThrow(
      SupabaseAdminConfigurationError,
    );
    expect(() => getSupabaseAdminEnv()).toThrow(
      "Missing or invalid server environment variables: SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("never falls back to a NEXT_PUBLIC service-role variable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
      "public-service-role-sentinel",
    );

    expect(() => getSupabaseAdminEnv()).toThrow(
      SupabaseAdminConfigurationError,
    );
  });
});
