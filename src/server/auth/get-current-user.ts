import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { getAuthConfig, isEmailAllowed } from "@/server/auth/config";

export type CurrentUser = {
  id: string;
  email?: string;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || typeof claims?.sub !== "string") {
    return null;
  }

  const email = typeof claims.email === "string" ? claims.email : undefined;

  if (!isEmailAllowed(email, getAuthConfig().allowedEmail)) {
    return null;
  }

  return { id: claims.sub, email };
});
