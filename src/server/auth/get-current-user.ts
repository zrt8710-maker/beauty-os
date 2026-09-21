import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { getAuthConfig, isEmailAllowed } from "@/server/auth/config";

export type AppRole = "user" | "admin";

export type CurrentUser = {
  id: string;
  email?: string;
  appRole: AppRole;
};

export type CurrentUserDiagnostic = {
  user: CurrentUser | null;
  reason: "authenticated" | "claims_error" | "missing_subject" | "email_not_allowed";
};

export async function getCurrentUserWithDiagnostic(): Promise<CurrentUserDiagnostic> {
  const supabase = await createClient();
  let result: Awaited<ReturnType<typeof supabase.auth.getClaims>>;
  try {
    result = await supabase.auth.getClaims();
  } catch {
    return { user: null, reason: "claims_error" };
  }
  const { data, error } = result;
  const claims = data?.claims;

  if (error || typeof claims?.sub !== "string") {
    return { user: null, reason: error ? "claims_error" : "missing_subject" };
  }

  const email = typeof claims.email === "string" ? claims.email : undefined;

  if (!isEmailAllowed(email, getAuthConfig().allowedEmail)) {
    return { user: null, reason: "email_not_allowed" };
  }

  return { user: { id: claims.sub, email, appRole: resolveAppRole(claims.app_metadata) }, reason: "authenticated" };
}

// Deduplicate layout/page authentication only within the same server render.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  return (await getCurrentUserWithDiagnostic()).user;
});

function resolveAppRole(appMetadata: unknown): AppRole {
  if (
    typeof appMetadata === "object"
    && appMetadata !== null
    && "app_role" in appMetadata
    && appMetadata.app_role === "admin"
  ) {
    return "admin";
  }

  return "user";
}
