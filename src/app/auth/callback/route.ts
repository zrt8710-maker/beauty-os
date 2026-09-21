import { NextResponse } from "next/server";
import { getPublicEnv } from "@/env";

import { createClient } from "@/lib/supabase/server";
import { completeMagicLink } from "@/server/auth/complete-magic-link";
import { getAuthConfig } from "@/server/auth/config";
import { createProfileRepository } from "@/server/repositories/profile-repository";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_code", appUrl),
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
      new URL(`/login?error=${result.reason}`, appUrl),
    );
  }

  try {
    const profile = await createProfileRepository(supabase).findByUserId(
      result.userId,
    );
    const destination = profile?.onboarding_completed_at ? "/app" : "/profile";
    return NextResponse.redirect(new URL(destination, appUrl));
  } catch {
    // The session is already established. Route to Profile so a transient
    // profile read cannot skip onboarding or invalidate the authenticated user.
    return NextResponse.redirect(new URL("/profile", appUrl));
  }
}
