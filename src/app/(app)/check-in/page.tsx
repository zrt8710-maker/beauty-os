import { redirect } from "next/navigation";

import { CheckinManager } from "@/features/check-in/checkin-manager";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOpenMeteoProvider } from "@/server/integrations/weather/open-meteo";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import { createSkinCheckinService } from "@/server/services/skin-checkin-service";
import { createWeatherService } from "@/server/services/weather-service";

export default async function CheckinPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  const supabase = await createClient();
  const profiles = createProfileRepository(supabase);
  const checkinService = createSkinCheckinService(
    createSkinCheckinRepository(supabase),
  );
  const weatherService = createWeatherService(
    createWeatherRepository(supabase),
    profiles,
    createOpenMeteoProvider(),
  );
  const [profile, checkins, weather] = await Promise.all([
    profiles.findByUserId(user.id),
    checkinService.listCheckins(user.id, { limit: 7 }),
    weatherService.getLatestWeather(user.id),
  ]);
  const today = formatDateInTimeZone(
    new Date(),
    profile?.timezone ?? "Asia/Shanghai",
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">Daily context</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">今日皮肤记录</h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          记录主观肤况和当天环境数据。本页面只保存事实，不生成护肤建议。
        </p>
      </div>
      <CheckinManager
        initialCheckins={checkins}
        initialWeather={weather}
        today={today}
      />
    </main>
  );
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
