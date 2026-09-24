import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/db/database.types";
import { getPublicEnv } from "@/env";
import { proxyRealtime } from "@/lib/supabase/proxy-realtime";

export async function updateSession(request: NextRequest) {
  // Signing in must remain possible even when an existing session cannot refresh.
  // Protected pages verify claims in their server layout and API handlers.
  if (["/login", "/auth/verify-otp", "/auth/callback", "/api/internal/product-research"].includes(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const env = getPublicEnv();
  // Forward the original request untouched. EdgeOne's request-header override
  // truncates large Cookie headers before the route receives them.
  let response = NextResponse.next();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      realtime: proxyRealtime,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  try {
    await supabase.auth.getClaims();
  } catch {
    // EdgeOne's Proxy can fail claims verification for a session that the
    // Node route validates. The protected layout and API handlers decide access.
  }

  return response;
}
