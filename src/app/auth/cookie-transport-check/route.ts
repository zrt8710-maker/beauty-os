import { type NextRequest, NextResponse } from "next/server";

const testValue = "a".repeat(3100);

// Temporary platform check using synthetic cookies only. No auth state is read.
export function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("verify")) {
    const response = NextResponse.json({
      first: request.cookies.get("bo_transport_0")?.value === testValue,
      second: request.cookies.get("bo_transport_1")?.value === testValue,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const response = NextResponse.redirect(
    new URL("/auth/cookie-transport-check?verify=1", request.url),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  for (const name of ["bo_transport_0", "bo_transport_1"]) {
    response.cookies.set(name, testValue, {
      httpOnly: true,
      maxAge: 60,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  }
  return response;
}
