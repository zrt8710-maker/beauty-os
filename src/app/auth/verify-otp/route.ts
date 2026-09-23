import { NextResponse } from "next/server";

import { verifyEmailOtp } from "@/app/(auth)/login/actions";

export async function POST(request: Request) {
  try {
    const result = await verifyEmailOtp(
      { status: "idle" },
      await request.formData(),
    );
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
