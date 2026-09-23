import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserWithDiagnostic } from "@/server/auth/get-current-user";

// Temporary, privacy-safe production diagnostic for the OTP redirect loop.
// Never return cookie values, tokens, user IDs, or email addresses.
export async function GET(request: NextRequest) {
  const hasAuthCookie = request.cookies.getAll().some(({ name }) =>
    /^sb-.+-auth-token(?:\.\d+)?$/.test(name),
  );

  if (!hasAuthCookie) {
    return diagnosticResponse({ hasAuthCookie, claims: "missing_cookie", user: "not_checked" });
  }

  const claims = (await getCurrentUserWithDiagnostic()).reason;
  let user: "valid" | "invalid" | "request_failed" = "invalid";
  try {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    user = result.data.user ? "valid" : result.error ? "request_failed" : "invalid";
  } catch {
    user = "request_failed";
  }

  return diagnosticResponse({ hasAuthCookie, claims, user });
}

function diagnosticResponse(result: {
  hasAuthCookie: boolean;
  claims: string;
  user: string;
}) {
  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
