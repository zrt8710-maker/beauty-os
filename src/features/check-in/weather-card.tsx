"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { weatherDataSchema, type WeatherData } from "@/schemas/weather";

export function WeatherCard({
  initialWeather,
}: {
  initialWeather: WeatherData | null;
}) {
  const [weather, setWeather] = useState(initialWeather);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  async function refreshWeather() {
    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch("/api/v1/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result: unknown = await response.json();
      const saved = parseData(result);

      if (!response.ok || !saved) {
        const code = readErrorCode(result);
        throw new Error(code);
      }

      setWeather(saved);
      setStatus("idle");
      setMessage("天气数据已更新。");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error && error.message === "WEATHER_LOCATION_REQUIRED"
          ? "请先在皮肤档案中填写经纬度和时区。"
          : "天气获取失败，已保留最近一次数据。",
      );
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">环境天气</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            数据来源为
            <a
              className="mx-1 text-primary hover:underline"
              href="https://open-meteo.com/"
              rel="noreferrer"
              target="_blank"
            >
              Open-Meteo
            </a>
            ，位置取自你的皮肤档案。
          </p>
        </div>
        <Button
          disabled={status === "loading"}
          onClick={refreshWeather}
          type="button"
          variant="outline"
        >
          {status === "loading" ? "获取中…" : "获取今日天气"}
        </Button>
      </div>

      {weather ? (
        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <WeatherValue label="温度" value={formatNumber(weather.temperature, "°C")} />
          <WeatherValue label="湿度" value={formatNumber(weather.humidity, "%")} />
          <WeatherValue label="今日最高 UV" value={formatNumber(weather.uv_index, "")} />
          <WeatherValue label="天气代码" value={weather.weather_code ?? "未知"} />
        </dl>
      ) : (
        <p className="mt-6 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
          尚无天气数据。请先确认
          <Link className="mx-1 text-primary hover:underline" href="/profile">
            皮肤档案
          </Link>
          中的位置，再获取今日天气。
        </p>
      )}

      {weather ? (
        <p className="mt-4 text-xs text-muted-foreground">
          记录日期：{weather.recorded_date} · 获取时间：
          {new Date(weather.created_at).toLocaleString("zh-CN")}
        </p>
      ) : null}
      <p
        aria-live="polite"
        className={status === "error" ? "mt-3 text-sm text-destructive" : "mt-3 text-sm text-muted-foreground"}
      >
        {message}
      </p>
    </section>
  );
}

function WeatherValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
    </div>
  );
}

function formatNumber(value: number | null, suffix: string) {
  return value === null ? "未知" : `${value}${suffix}`;
}

function parseData(value: unknown): WeatherData | null {
  if (typeof value !== "object" || value === null || !("data" in value)) return null;
  const result = weatherDataSchema.safeParse(value.data);
  return result.success ? result.data : null;
}

function readErrorCode(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "code" in value.error &&
    typeof value.error.code === "string"
  ) {
    return value.error.code;
  }

  return "WEATHER_REQUEST_FAILED";
}
