import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { completeMagicLink } from "@/server/auth/complete-magic-link";
import { getAuthConfig } from "@/server/auth/config";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_code", requestUrl.origin),
    );
  }

  const supabase = await createClient();
  const result = await completeMagicLink(
    supabase,
    code,
    getAuthConfig().allowedEmail,
  );

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/login?error=${result.reason}`, requestUrl.origin),
    );
  }

  return NextResponse.redirect(new URL("/app", requestUrl.origin));
}
