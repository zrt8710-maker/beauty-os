import { NextResponse } from "next/server";

import { verifyEmailOtpRequest } from "@/server/auth/verify-email-otp-request";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as { email?: unknown; token?: unknown };
    const formData = new FormData();
    formData.set("email", typeof input.email === "string" ? input.email : "");
    formData.set("token", typeof input.token === "string" ? input.token : "");
    const result = await verifyEmailOtpRequest(formData);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { status: "error", message: "验证失败，请稍后重试。" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
