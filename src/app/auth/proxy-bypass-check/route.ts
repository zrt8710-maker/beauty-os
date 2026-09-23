import { type NextRequest, NextResponse } from "next/server";

const testValue = "a".repeat(3100);

// Temporary platform probe using synthetic values only.
export function GET(request: NextRequest) {
  const rawCookieHeader = request.headers.get("cookie") ?? "";
  const response = NextResponse.json({
    firstComplete: rawCookieHeader.includes(`bo_transport_0=${testValue}`),
    secondComplete: rawCookieHeader.includes(`bo_transport_1=${testValue}`),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
