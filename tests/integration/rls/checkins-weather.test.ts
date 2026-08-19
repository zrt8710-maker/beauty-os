import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const checkinMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260818040000_create_skin_checkins.sql",
      import.meta.url,
    ),
  ),
  "utf8",
).toLowerCase();

const weatherMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260818041000_create_weather_data.sql",
      import.meta.url,
    ),
  ),
  "utf8",
).toLowerCase();

describe("check-in 与 weather migration 契约", () => {
  it("两张表都有 owner-only RLS 和 auth.users 外键", () => {
    for (const [sql, table] of [
      [checkinMigration, "skin_checkins"],
      [weatherMigration, "weather_data"],
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain("references auth.users (id) on delete cascade");
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain("(select auth.uid()) = user_id");
      expect(sql).toContain(`revoke all on table public.${table} from anon`);
    }
  });

  it("check-in 每日唯一且所有等级限制为 0..4", () => {
    expect(checkinMigration).toContain("unique (user_id, recorded_date)");
    for (const field of [
      "dryness_level",
      "oiliness_level",
      "redness_level",
      "sensitivity_level",
      "acne_level",
    ]) {
      expect(checkinMigration).toContain(`check (${field} between 0 and 4)`);
    }
  });

  it("天气每日唯一、保存 JSON 快照并限制湿度与 UV", () => {
    expect(weatherMigration).toContain("unique (user_id, recorded_date)");
    expect(weatherMigration).toContain("raw_payload jsonb not null");
    expect(weatherMigration).toContain("jsonb_typeof(raw_payload) = 'object'");
    expect(weatherMigration).toContain("humidity between 0 and 100");
    expect(weatherMigration).toContain("uv_index between 0 and 30");
  });
});

const testEnvironment = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  userAEmail: process.env.SUPABASE_TEST_USER_A_EMAIL,
  userAPassword: process.env.SUPABASE_TEST_USER_A_PASSWORD,
  userBEmail: process.env.SUPABASE_TEST_USER_B_EMAIL,
  userBPassword: process.env.SUPABASE_TEST_USER_B_PASSWORD,
};

const hasLiveTestEnvironment = Object.values(testEnvironment).every(Boolean);
const describeLive = hasLiveTestEnvironment ? describe : describe.skip;
const liveRecordedDate = createIsolatedTestDate();

describeLive("check-in 与 weather 双用户隔离（真实 Supabase）", () => {
  let clientA!: SupabaseClient<Database>;
  let clientB!: SupabaseClient<Database>;
  let userAId = "";
  let userBId = "";

  beforeAll(async () => {
    clientA = createClient<Database>(testEnvironment.url!, testEnvironment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientB = createClient<Database>(testEnvironment.url!, testEnvironment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [sessionA, sessionB] = await Promise.all([
      clientA.auth.signInWithPassword({
        email: testEnvironment.userAEmail!,
        password: testEnvironment.userAPassword!,
      }),
      clientB.auth.signInWithPassword({
        email: testEnvironment.userBEmail!,
        password: testEnvironment.userBPassword!,
      }),
    ]);

    if (sessionA.error || sessionB.error) {
      throw new Error("RLS test users could not authenticate.");
    }

    userAId = sessionA.data.user.id;
    userBId = sessionB.data.user.id;
    const writes = await Promise.all([
      clientA.from("skin_checkins").upsert(checkinInput(userAId, 1)),
      clientB.from("skin_checkins").upsert(checkinInput(userBId, 2)),
      clientA.from("weather_data").upsert(weatherInput(userAId, 20)),
      clientB.from("weather_data").upsert(weatherInput(userBId, 30)),
    ]);

    if (writes.some((result) => result.error)) {
      throw new Error("Check-in/weather RLS fixtures could not be created.");
    }
  });

  afterAll(async () => {
    await Promise.all([
      clientA.from("skin_checkins").delete().eq("recorded_date", liveRecordedDate),
      clientB.from("skin_checkins").delete().eq("recorded_date", liveRecordedDate),
      clientA.from("weather_data").delete().eq("recorded_date", liveRecordedDate),
      clientB.from("weather_data").delete().eq("recorded_date", liveRecordedDate),
    ]);
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  });

  it("两个用户不能互相读取 check-in 或天气数据", async () => {
    const results = await Promise.all([
      clientA.from("skin_checkins").select("id").eq("user_id", userBId),
      clientB.from("skin_checkins").select("id").eq("user_id", userAId),
      clientA.from("weather_data").select("id").eq("user_id", userBId),
      clientB.from("weather_data").select("id").eq("user_id", userAId),
    ]);

    for (const result of results) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
  });

  it("同一天 upsert 更新自己的 check-in 而不新增第二条", async () => {
    const update = await clientA
      .from("skin_checkins")
      .upsert(checkinInput(userAId, 4), { onConflict: "user_id,recorded_date" })
      .select("id,dryness_level");

    expect(update.error).toBeNull();
    expect(update.data).toHaveLength(1);
    expect(update.data?.[0].dryness_level).toBe(4);
  });
});

function checkinInput(userId: string, dryness: number) {
  return {
    user_id: userId,
    recorded_date: liveRecordedDate,
    dryness_level: dryness,
    oiliness_level: 0,
    redness_level: 0,
    sensitivity_level: 0,
    acne_level: 0,
  };
}

function weatherInput(userId: string, temperature: number) {
  return {
    user_id: userId,
    recorded_date: liveRecordedDate,
    temperature,
    humidity: 50,
    uv_index: 3,
    weather_code: "0",
    source: "open_meteo",
    raw_payload: { test: true },
  };
}

function createIsolatedTestDate() {
  const randomDayOffset =
    Number.parseInt(crypto.randomUUID().replaceAll("-", "").slice(0, 8), 16) %
    36_500;

  return new Date(
    Date.UTC(2100, 0, 1) + randomDayOffset * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
}
