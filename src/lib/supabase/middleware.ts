import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/db/database.types";
import { getPublicEnv } from "@/env";

function copyResponseCookies(source: NextResponse, target: NextResponse): void {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
}

export async function updateSession(request: NextRequest) {
  // Signing in must remain possible even when an existing session cannot refresh.
  // Protected pages still verify claims through the normal path below.
  if (request.nextUrl.pathname === "/login") {
    return NextResponse.next({ request });
  }

  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
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

  let data: { claims?: { sub?: unknown } } | null = null;
  let error: unknown = null;
  try {
    const result = await supabase.auth.getClaims();
    data = result.data;
    error = result.error;
  } catch {
    // A malformed cookie is never accepted as a session. Continue through the
    // normal unauthenticated redirect path rather than returning a proxy 500.
    data = null;
    error = new Error("MALFORMED_AUTH_SESSION");
  }
  const isAuthenticated = !error && typeof data?.claims?.sub === "string";
  const isProtectedRoute = request.nextUrl.pathname.startsWith("/app");

  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    const redirectResponse = NextResponse.redirect(loginUrl);
    copyResponseCookies(response, redirectResponse);
    return redirectResponse;
  }

  return response;
}
