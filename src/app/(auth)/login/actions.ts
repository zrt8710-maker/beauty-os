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
  const env = getPublicEnv();
  const authConfig = getAuthConfig();
  const supabase = await createClient();

  return requestMagicLink(
    {
      email: formData.get("email"),
      redirectTo: new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL).toString(),
      allowedEmail: authConfig.allowedEmail,
    },
    async ({ email, redirectTo }) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });

      return { error };
    },
  );
}
