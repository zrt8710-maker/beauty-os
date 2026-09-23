import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/db/database.types";
import { getPublicEnv } from "@/env";
import { serverRealtime } from "@/lib/supabase/server-realtime";
import { verifyEmailOtpRequest } from "@/server/auth/verify-email-otp-request";

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as { email?: unknown; token?: unknown };
    const formData = new FormData();
    formData.set("email", typeof input.email === "string" ? input.email : "");
    formData.set("token", typeof input.token === "string" ? input.token : "");

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
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
    cookieUpdates.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    return response;
  } catch {
    return NextResponse.json(
      { status: "error", message: "验证失败，请稍后重试。" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
