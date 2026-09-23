import { createClient } from "@/lib/supabase/server";
import { getAuthConfig } from "@/server/auth/config";
import {
  type EmailOtpActionState,
  verifyEmailOtpCode,
} from "@/server/auth/email-otp";
import { createProfileRepository } from "@/server/repositories/profile-repository";

export async function verifyEmailOtpRequest(
  formData: FormData,
  providedClient?: Awaited<ReturnType<typeof createClient>>,
): Promise<EmailOtpActionState> {
  const supabase = providedClient ?? await createClient();
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
