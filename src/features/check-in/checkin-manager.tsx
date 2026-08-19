"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  skinCheckinSchema,
  type SkinCheckin,
  type SkinCheckinInput,
} from "@/schemas/checkin";
import type { WeatherData } from "@/schemas/weather";
import { WeatherCard } from "@/features/check-in/weather-card";

const levelLabels = ["无", "轻微", "一般", "明显", "严重"];

type CheckinDraft = SkinCheckinInput;

export function CheckinManager({
  initialCheckins,
  initialWeather,
  today,
}: {
  initialCheckins: SkinCheckin[];
  initialWeather: WeatherData | null;
  today: string;
}) {
  const todayCheckin = initialCheckins.find(
    (checkin) => checkin.recorded_date === today,
  );
  const [checkins, setCheckins] = useState(initialCheckins);
  const [draft, setDraft] = useState<CheckinDraft>(
    todayCheckin
      ? toDraft(todayCheckin)
      : {
          dryness_level: 0,
          oiliness_level: 0,
          redness_level: 0,
          sensitivity_level: 0,
          acne_level: 0,
          notes: null,
          recorded_date: today,
        },
  );
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  async function saveCheckin() {
    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch("/api/v1/skin-checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result: unknown = await response.json();
      const saved = parseData(result);

      if (!response.ok || !saved) throw new Error("SAVE_FAILED");

      setCheckins((current) =>
        [saved, ...current.filter((item) => item.id !== saved.id)].sort((a, b) =>
          b.recorded_date.localeCompare(a.recorded_date),
        ),
      );
      setStatus("idle");
      setMessage("皮肤状态已保存；同一天再次保存会更新原记录。");
    } catch {
      setStatus("error");
      setMessage("保存失败，请检查等级和日期后重试。");
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">填写皮肤状态</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          0 表示没有，4 表示严重。这是主观日常记录，不是医疗诊断。
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="记录日期">
            <input
              className={inputClassName}
              onChange={(event) => setDraft((current) => ({ ...current, recorded_date: event.target.value }))}
              type="date"
              value={draft.recorded_date}
            />
          </Field>
          <div className="hidden sm:block" />
          <LevelField label="干燥" onChange={(value) => setDraft((current) => ({ ...current, dryness_level: value }))} value={draft.dryness_level} />
          <LevelField label="出油" onChange={(value) => setDraft((current) => ({ ...current, oiliness_level: value }))} value={draft.oiliness_level} />
          <LevelField label="泛红" onChange={(value) => setDraft((current) => ({ ...current, redness_level: value }))} value={draft.redness_level} />
          <LevelField label="敏感" onChange={(value) => setDraft((current) => ({ ...current, sensitivity_level: value }))} value={draft.sensitivity_level} />
          <LevelField label="痘痘" onChange={(value) => setDraft((current) => ({ ...current, acne_level: value }))} value={draft.acne_level} />
          <Field label="备注（可选）">
            <textarea
              className={`${inputClassName} min-h-24 py-3`}
              maxLength={2000}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value.trim() ? event.target.value : null }))}
              placeholder="例如：洗脸后紧绷，鼻翼略红"
              value={draft.notes ?? ""}
            />
          </Field>
        </div>

        <div className="mt-6 flex items-center gap-4">
          <Button disabled={status === "saving"} onClick={saveCheckin} type="button">
            {status === "saving" ? "保存中…" : "保存今日记录"}
          </Button>
          <p
            aria-live="polite"
            className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
          >
            {message}
          </p>
        </div>
      </section>

      <WeatherCard initialWeather={initialWeather} />

      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">最近记录</h2>
        {checkins.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">还没有皮肤状态记录。</p>
        ) : (
          <ul className="mt-5 space-y-3">
            {checkins.map((checkin) => (
              <li className="rounded-xl border p-4" key={checkin.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{checkin.recorded_date}</p>
                  <p className="text-xs text-muted-foreground">
                    干燥 {checkin.dryness_level} · 出油 {checkin.oiliness_level} · 泛红 {checkin.redness_level} · 敏感 {checkin.sensitivity_level} · 痘痘 {checkin.acne_level}
                  </p>
                </div>
                {checkin.notes ? <p className="mt-2 text-sm text-muted-foreground">{checkin.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LevelField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <select
        className={inputClassName}
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {levelLabels.map((level, index) => (
          <option key={level} value={index}>{index} — {level}</option>
        ))}
      </select>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function toDraft(checkin: SkinCheckin): CheckinDraft {
  return {
    dryness_level: checkin.dryness_level,
    oiliness_level: checkin.oiliness_level,
    redness_level: checkin.redness_level,
    sensitivity_level: checkin.sensitivity_level,
    acne_level: checkin.acne_level,
    notes: checkin.notes,
    recorded_date: checkin.recorded_date,
  };
}

function parseData(value: unknown): SkinCheckin | null {
  if (typeof value !== "object" || value === null || !("data" in value)) return null;
  const result = skinCheckinSchema.safeParse(value.data);
  return result.success ? result.data : null;
}

const inputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 font-normal outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
