"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { textureLabels } from "@/features/profile/profile-report";
import {
  TEXTURE_PREFERENCES,
  profileSchema,
  type Profile,
  type ProfileInput,
} from "@/schemas/profile";

type SaveStatus = "idle" | "saving" | "success" | "error";

export function CarePreferencesForm({ initialProfile }: { initialProfile: Profile }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState("");

  function setStepLimit(period: "am_steps" | "pm_steps", value: number) {
    setProfile((current) => ({
      ...current,
      preferred_routine_length: {
        ...current.preferred_routine_length,
        [period]: value,
      },
    }));
  }

  function toggleTexture(texture: (typeof TEXTURE_PREFERENCES)[number]) {
    setProfile((current) => ({
      ...current,
      texture_preferences: current.texture_preferences.includes(texture)
        ? current.texture_preferences.filter((item) => item !== texture)
        : [...current.texture_preferences, texture],
    }));
  }

  async function savePreferences() {
    setStatus("saving");
    setMessage("");
    const input: ProfileInput = {
      skin_type: profile.skin_type,
      sensitivity_level: profile.sensitivity_level,
      skin_goals: profile.skin_goals,
      long_term_skin_baseline: profile.long_term_skin_baseline,
      preferred_routine_length: profile.preferred_routine_length,
      texture_preferences: profile.texture_preferences,
      avoid_ingredients: profile.avoid_ingredients,
      timezone: profile.timezone,
      location: profile.location,
    };

    try {
      const response = await fetch("/api/v1/profile?section=care-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json();
      const saved = readProfile(body);
      if (!response.ok || !saved) {
        setStatus("error");
        setMessage("护理偏好保存失败，请稍后重试。");
        return;
      }
      setProfile(saved);
      setStatus("success");
      setMessage("护理偏好已保存。");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("网络连接失败，请稍后重试。");
    }
  }

  return (
    <div className="beauty-paper max-w-4xl space-y-6">
      <section className="pb-7">
        <h2 className="text-xl font-semibold">方案长度</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          设置日常护理方案最多包含多少个步骤。
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <NumberField
            label="早间最多步骤"
            onChange={(value) => setStepLimit("am_steps", value)}
            value={profile.preferred_routine_length.am_steps}
          />
          <NumberField
            label="晚间最多步骤"
            onChange={(value) => setStepLimit("pm_steps", value)}
            value={profile.preferred_routine_length.pm_steps}
          />
        </div>
      </section>

      <section className="beauty-section">
        <h2 className="text-xl font-semibold">质地偏好</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          选择你更愿意长期使用的产品质地，可以多选。
        </p>
        <fieldset className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="sr-only">质地偏好</legend>
          {TEXTURE_PREFERENCES.map((texture) => (
            <label className={`beauty-choice-row ${profile.texture_preferences.includes(texture) ? "border-selected-border bg-selected text-selected-foreground" : ""}`} key={texture}>
              <input
                checked={profile.texture_preferences.includes(texture)}
                onChange={() => toggleTexture(texture)}
                type="checkbox"
              />
              {textureLabels[texture]}
            </label>
          ))}
        </fieldset>
      </section>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex flex-col gap-3 border-t border-border/80 bg-background/95 px-1 py-4 backdrop-blur-md sm:static sm:flex-row sm:items-center sm:justify-between lg:bottom-0">
        <p
          aria-live="polite"
          className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {message || "按你的日常节奏，安排更适合自己的护理方案。"}
        </p>
        <Button disabled={status === "saving"} onClick={() => void savePreferences()} type="button">
          <BeautyNavIcon name="save" size={16} />
          {status === "saving" ? "正在保存…" : "保存护理偏好"}
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="space-y-2 text-sm font-medium">
      <span>{label}</span>
      <input
        className="beauty-field font-normal"
        max={8}
        min={1}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </label>
  );
}

function readProfile(value: unknown): Profile | null {
  if (!value || typeof value !== "object" || !("data" in value)) return null;
  const result = profileSchema.safeParse(value.data);
  return result.success ? result.data : null;
}
