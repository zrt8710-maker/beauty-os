import { redirect } from "next/navigation";

import { TodayRoutine } from "@/features/today/today-routine";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createRuleEngineService } from "@/server/services/rule-engine-service";
import { createUsageService } from "@/server/services/usage-service";

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const profiles = createProfileRepository(supabase);
  const checkins = createSkinCheckinRepository(supabase);
  const weather = createWeatherRepository(supabase);
  const routines = createRoutineRepository(supabase);
  const profile = await profiles.findByUserId(user.id);
  const today = formatDateInTimeZone(new Date(), profile?.timezone ?? "Asia/Shanghai");
  const service = createRuleEngineService({
    profiles,
    checkins,
    weather,
    ownedProducts: createOwnedProductRepository(supabase),
    routines,
    usage: createUsageService(createUsageRepository(supabase), routines),
  });
  const [routine, checkin, weatherData] = await Promise.all([
    service.getToday(user.id, { period: "am" }),
    checkins.findByDate(user.id, today),
    weather.findByDate(user.id, today),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">Today</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">今日护肤</h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          根据今天的皮肤记录、天气和你的现有库存生成。所有原因来自固定规则，不是 AI 解释。
        </p>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <ContextCard title="今日天气">
          {weatherData ? `${weatherData.temperature ?? "--"}°C · 湿度 ${weatherData.humidity ?? "--"}% · UV ${weatherData.uv_index ?? "--"}` : "今天还没有天气数据"}
        </ContextCard>
        <ContextCard title="今日皮肤状态">
          {checkin ? `干燥 ${checkin.dryness_level} · 出油 ${checkin.oiliness_level} · 泛红 ${checkin.redness_level} · 敏感 ${checkin.sensitivity_level}` : "今天还没有皮肤记录"}
        </ContextCard>
      </div>

      <TodayRoutine initialRoutine={routine} />
    </main>
  );
}

function ContextCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </section>
  );
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
