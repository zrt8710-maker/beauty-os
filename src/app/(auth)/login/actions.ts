"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthConfig } from "@/server/auth/config";
import {
  requestEmailOtp,
  type EmailOtpActionState,
} from "@/server/auth/email-otp";
import { verifyEmailOtpRequest } from "@/server/auth/verify-email-otp-request";

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
  return verifyEmailOtpRequest(formData);
}
