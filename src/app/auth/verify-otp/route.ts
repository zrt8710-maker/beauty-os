import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/db/database.types";
import { getPublicEnv } from "@/env";
import { serverRealtime } from "@/lib/supabase/server-realtime";
import { verifyEmailOtpRequest } from "@/server/auth/verify-email-otp-request";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const env = getPublicEnv();
    const cookieUpdates: Array<{ name: string; value: string; options: CookieOptions }> = [];
    const supabase = createServerClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        realtime: serverRealtime,
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach((cookie) => {
              request.cookies.set(cookie.name, cookie.value);
              cookieUpdates.push(cookie);
            });
          },
        },
      },
    );

    const result = await verifyEmailOtpRequest(formData, supabase);
    if (result.status === "success" && cookieUpdates.length === 0) {
      return loginError(request, "otp_session");
    }
    if (result.status !== "success" || !result.redirectTo) {
      const reason = result.message?.includes("网络")
        ? "otp_network"
        : result.message?.includes("会话")
          ? "otp_session"
          : "invalid_otp";
      return loginError(request, reason);
    }

    const response = NextResponse.redirect(new URL(result.redirectTo, request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Auth-Cookie-Writes", String(cookieUpdates.length));
    cookieUpdates.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    return response;
  } catch {
    return loginError(request, "otp_network");
  }
}

function loginError(request: NextRequest, reason: "invalid_otp" | "otp_session" | "otp_network") {
  const response = NextResponse.redirect(new URL(`/login?error=${reason}`, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
