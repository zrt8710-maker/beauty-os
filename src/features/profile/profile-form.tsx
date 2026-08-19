"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  SKIN_GOALS,
  SKIN_TYPES,
  TEXTURE_PREFERENCES,
  profileSchema,
  type Profile,
  type ProfileInput,
} from "@/schemas/profile";

const skinTypeLabels: Record<(typeof SKIN_TYPES)[number], string> = {
  dry: "干性",
  oily: "油性",
  combination: "混合性",
  normal: "中性",
  unknown: "暂不确定",
};

const skinGoalLabels: Record<(typeof SKIN_GOALS)[number], string> = {
  hydration: "补水保湿",
  barrier_support: "屏障维护",
  oil_control: "控油",
  blemish_care: "痘痘护理",
  redness_relief: "舒缓泛红",
  brightening: "提亮",
  dark_spots: "淡化色沉",
  anti_aging: "抗老",
};

const textureLabels: Record<(typeof TEXTURE_PREFERENCES)[number], string> = {
  lightweight: "轻薄",
  rich: "滋润",
  gel: "啫喱",
  cream: "面霜",
  lotion: "乳液",
  oil: "油类",
};

type ProfileFormProps = {
  initialProfile: Profile;
};

function splitAvoidIngredients(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function ProfileForm({ initialProfile }: ProfileFormProps) {
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [avoidIngredientsText, setAvoidIngredientsText] = useState(
    initialProfile.avoid_ingredients.join(", "),
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  function toggleSkinGoal(goal: (typeof SKIN_GOALS)[number]) {
    setProfile((current) => ({
      ...current,
      skin_goals: current.skin_goals.includes(goal)
        ? current.skin_goals.filter((item) => item !== goal)
        : [...current.skin_goals, goal],
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

  async function saveProfile() {
    setStatus("saving");
    setMessage("");

    const input: ProfileInput = {
      skin_type: profile.skin_type,
      sensitivity_level: profile.sensitivity_level,
      skin_goals: profile.skin_goals,
      preferred_routine_length: profile.preferred_routine_length,
      texture_preferences: profile.texture_preferences,
      avoid_ingredients: splitAvoidIngredients(avoidIngredientsText),
      timezone: profile.timezone,
      location: profile.location,
    };

    try {
      const response = await fetch("/api/v1/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result: unknown = await response.json();

      const savedProfile = parseProfileResponse(result);

      if (!response.ok || !savedProfile) {
        setStatus("error");
        setMessage("保存失败，请检查填写内容后重试。");
        return;
      }

      setProfile(savedProfile);
      setAvoidIngredientsText(savedProfile.avoid_ingredients.join(", "));
      setStatus("success");
      setMessage("皮肤档案已保存。");
    } catch {
      setStatus("error");
      setMessage("网络连接失败，请稍后重试。");
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">基础皮肤信息</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            <span>肤质</span>
            <select
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  skin_type: event.target.value
                    ? (event.target.value as Profile["skin_type"])
                    : null,
                }))
              }
              value={profile.skin_type ?? ""}
            >
              <option value="">请选择</option>
              {SKIN_TYPES.map((skinType) => (
                <option key={skinType} value={skinType}>
                  {skinTypeLabels[skinType]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium">
            <span>敏感程度</span>
            <select
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  sensitivity_level: Number(event.target.value),
                }))
              }
              value={profile.sensitivity_level}
            >
              <option value={0}>0 · 不敏感</option>
              <option value={1}>1 · 偶尔敏感</option>
              <option value={2}>2 · 轻度敏感</option>
              <option value={3}>3 · 明显敏感</option>
              <option value={4}>4 · 高度敏感</option>
            </select>
          </label>
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium">护肤目标</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SKIN_GOALS.map((goal) => (
              <label
                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-sm"
                key={goal}
              >
                <input
                  checked={profile.skin_goals.includes(goal)}
                  onChange={() => toggleSkinGoal(goal)}
                  type="checkbox"
                />
                {skinGoalLabels[goal]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">护肤偏好</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            <span>早间最多步骤</span>
            <input
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              max={8}
              min={1}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  preferred_routine_length: {
                    ...current.preferred_routine_length,
                    am_steps: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={profile.preferred_routine_length.am_steps}
            />
          </label>
          <label className="space-y-2 text-sm font-medium">
            <span>晚间最多步骤</span>
            <input
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              max={8}
              min={1}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  preferred_routine_length: {
                    ...current.preferred_routine_length,
                    pm_steps: Number(event.target.value),
                  },
                }))
              }
              type="number"
              value={profile.preferred_routine_length.pm_steps}
            />
          </label>
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium">偏好质地</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {TEXTURE_PREFERENCES.map((texture) => (
              <label
                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-sm"
                key={texture}
              >
                <input
                  checked={profile.texture_preferences.includes(texture)}
                  onChange={() => toggleTexture(texture)}
                  type="checkbox"
                />
                {textureLabels[texture]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-6 block space-y-2 text-sm font-medium">
          <span>避用成分</span>
          <textarea
            className="min-h-24 w-full rounded-lg border bg-background px-3 py-2 font-normal"
            onChange={(event) => setAvoidIngredientsText(event.target.value)}
            placeholder="用逗号或换行分隔，例如：香精，酒精"
            value={avoidIngredientsText}
          />
        </label>
      </section>

      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">位置与时区</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          这里只保存你主动填写的信息，供后续天气适配使用。
        </p>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            <span>位置名称</span>
            <input
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  location: {
                    ...current.location,
                    name: event.target.value === "" ? null : event.target.value,
                  },
                }))
              }
              placeholder="例如：上海"
              value={profile.location.name ?? ""}
            />
          </label>
          <label className="space-y-2 text-sm font-medium">
            <span>IANA 时区</span>
            <input
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
              placeholder="Asia/Shanghai"
              value={profile.timezone}
            />
          </label>
          <label className="space-y-2 text-sm font-medium">
            <span>纬度（可选）</span>
            <input
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              max={90}
              min={-90}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  location: {
                    ...current.location,
                    latitude:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  },
                }))
              }
              step="0.00001"
              type="number"
              value={profile.location.latitude ?? ""}
            />
          </label>
          <label className="space-y-2 text-sm font-medium">
            <span>经度（可选）</span>
            <input
              className="h-11 w-full rounded-lg border bg-background px-3 font-normal"
              max={180}
              min={-180}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  location: {
                    ...current.location,
                    longitude:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  },
                }))
              }
              step="0.00001"
              type="number"
              value={profile.location.longitude ?? ""}
            />
          </label>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border bg-background p-5 sm:flex-row sm:items-center sm:justify-between">
        <p
          aria-live="polite"
          className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {message ||
            (profile.onboarding_completed_at
              ? "档案已建立，可随时修改。"
              : "首次保存后即完成档案建立。")}
        </p>
        <Button
          className="h-10 px-5"
          disabled={status === "saving"}
          onClick={saveProfile}
          type="button"
        >
          {status === "saving" ? "正在保存…" : "保存档案"}
        </Button>
      </div>
    </div>
  );
}

function parseProfileResponse(value: unknown): Profile | null {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return null;
  }

  const result = profileSchema.safeParse(value.data);
  return result.success ? result.data : null;
}
