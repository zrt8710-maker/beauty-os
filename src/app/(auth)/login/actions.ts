"use server";

import { getPublicEnv } from "@/env";
import { createClient } from "@/lib/supabase/server";
import { getAuthConfig } from "@/server/auth/config";
import {
  requestMagicLink,
  type LoginActionState,
} from "@/server/auth/request-magic-link";

export async function sendMagicLink(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const authConfig = getAuthConfig();
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const supabase = await createClient();

  return requestMagicLink(
    {
      email: formData.get("email"),
      redirectTo: new URL("/auth/callback", appUrl).toString(),
      allowedEmail: authConfig.allowedEmail,
    },
    async ({ email, redirectTo }) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        console.warn("[auth] Magic Link request rejected", {
          name: error.name,
          status: error.status,
          code: error.code,
        });
      }

      return { error };
    },
  );
}
