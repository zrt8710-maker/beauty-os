import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProfileRepository } from "@/server/repositories/profile-repository";

const headers = { "Cache-Control": "private, no-store" };

/** Development-only test fixture reset. It derives both identity and local date on the server. */
export async function POST() {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: { code: "NOT_FOUND", message: "未找到该接口。" } }, { status: 404, headers });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录。" } }, { status: 401, headers });
  try {
    const supabase = await createClient();
    const profile = await createProfileRepository(supabase).findByUserId(user.id);
    const today = formatDateInTimeZone(new Date(), profile?.timezone ?? "Asia/Shanghai");
    const { error } = await supabase.from("skin_checkins").delete().eq("user_id", user.id).eq("recorded_date", today);
    if (error) throw error;
    return NextResponse.json({ data: { recorded_date: today } }, { headers });
  } catch {
    return NextResponse.json({ error: { code: "DAILY_SKIN_RESET_FAILED", message: "无法重置今日测试记录。" } }, { status: 500, headers });
  }
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
