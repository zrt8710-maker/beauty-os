import { redirect } from "next/navigation";

import { buildEffectiveDailySkinState } from "@/features/check-in/effective-daily-skin-state";
import { describeEffectiveTodaySkin } from "@/features/today/effective-today-skin-context";
import { TodayRoutine } from "@/features/today/today-routine";
import { createClient } from "@/lib/supabase/server";
import type { RoutinePeriod } from "@/schemas/routine";
import { getAppShellContext, getProfileContext } from "@/server/app-shell/app-shell-context";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { toRoutine } from "@/server/services/rule-engine-service";

export async function TodayRouteView({ period }: { period: RoutinePeriod }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const checkins = createSkinCheckinRepository(supabase);
  const routines = createRoutineRepository(supabase);
  const usage = createUsageRepository(supabase);
  const { profile } = await getProfileContext(user.id);
  const today = formatDateInTimeZone(new Date(), profile?.timezone ?? "Asia/Shanghai");
  const [routineRows, checkin, usageHistory, { weather: weatherData }] = await Promise.all([
    routines.listByDate(user.id, today),
    checkins.findByDate(user.id, today),
    usage.listByUserId(user.id, 100),
    getAppShellContext(user.id),
  ]);
  const initialRoutines = routineRows.map(toRoutine);

  return (
    <main className="beauty-ambient-page beauty-ambient-today beauty-page min-h-svh">
      <div className="beauty-page-header">
        <h1 className="beauty-page-title">今日护理</h1>
        <p className="beauty-copy mt-3">
          先看今天为什么这样护理，再按顺序使用现有产品。
        </p>
      </div>

      <TodayRoutine
        activePeriod={period}
        initialFeedbackRoutineIds={usageHistory.map((history) => history.routine_id)}
        context={{
          skinStatus: checkin
            ? describeEffectiveTodaySkin(buildEffectiveDailySkinState({ checkin: checkin as never, profile: profile as never }))
            : "今天状态尚未记录；方案依据长期档案和可用信息生成。",
          environment: weatherData ? describeEnvironment(weatherData) : "今天暂无环境数据。",
        }}
        initialRoutines={initialRoutines}
      />
    </main>
  );
}

function describeEnvironment(weather: { temperature: number | null; humidity: number | null; uv_index: number | null }) {
  const observations = [
    weather.humidity !== null && weather.humidity < 40 ? "环境较干燥" : null,
    weather.uv_index !== null && weather.uv_index >= 6 ? "UV 较高" : null,
  ].filter(Boolean);
  return observations.length
    ? observations.join("，")
    : `温度 ${weather.temperature ?? "--"}℃ · 湿度 ${weather.humidity ?? "--"}% · UV ${weather.uv_index ?? "--"}`;
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
