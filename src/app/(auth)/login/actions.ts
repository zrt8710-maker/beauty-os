"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthConfig } from "@/server/auth/config";
import {
  requestEmailOtp,
  type EmailOtpActionState,
  verifyEmailOtpCode,
} from "@/server/auth/email-otp";
import { createProfileRepository } from "@/server/repositories/profile-repository";

export async function sendEmailOtp(
  _previousState: EmailOtpActionState,
  formData: FormData,
): Promise<EmailOtpActionState> {
  const authConfig = getAuthConfig();
  const supabase = await createClient();

  const result = await requestEmailOtp(
    {
      email: formData.get("email"),
      allowedEmail: authConfig.allowedEmail,
    },
    async (email) => {
      try {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        });

        if (error) {
          console.warn("[auth] Email OTP request rejected", {
            name: error.name,
            status: error.status,
            code: error.code,
          });
        }

        return { error };
      } catch {
        return { error: { message: "network failure", code: "network_error" } };
      }
    },
  );

  return result.status === "success"
    ? {
        ...result,
        email: String(formData.get("email")).trim().toLowerCase(),
        cooldownUntil: Date.now() + 60_000,
      }
    : result;
}

export async function verifyEmailOtp(
  _previousState: EmailOtpActionState,
  formData: FormData,
): Promise<EmailOtpActionState> {
  const supabase = await createClient();
  let userId: string | undefined;

  const result = await verifyEmailOtpCode(
    {
      email: formData.get("email"),
      token: formData.get("token"),
      allowedEmail: getAuthConfig().allowedEmail,
    },
    async (email, token) => {
      try {
        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: "email",
        });
        userId = data.user?.id;
        return { error };
      } catch {
        return { error: { message: "network failure", code: "network_error" } };
      }
    },
  );

  if (result.status !== "success" || !userId) {
    return result.status === "success"
      ? { status: "error", message: "验证码错误或已过期，请重新获取。" }
      : result;
  }

  try {
    const profile = await createProfileRepository(supabase).findByUserId(userId);
    return {
      ...result,
      redirectTo: profile?.onboarding_completed_at ? "/app" : "/profile",
    };
  } catch {
    return { ...result, redirectTo: "/profile" };
  }
}
