"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { LongTermBaselineEditor, LongTermBaselineSummary } from "@/features/profile/long-term-baseline-editor";
import { applyProfileSuggestionIntent, type ProfileSuggestionIntent } from "@/features/profile/profile-suggestion-intent";
import {
  baselineLabel,
  baselineOptions,
  sensitivityTendencyLabel,
  sensitivityTendencyOptions,
} from "@/features/profile/profile-presentation";
import { skinGoalLabels } from "@/features/profile/profile-report";
import {
  SKIN_GOALS,
  profileSchema,
  type Profile,
  type ProfileInput,
} from "@/schemas/profile";

type ProfileFormProps = {
  initialProfile: Profile;
  suggestionIntent?: ProfileSuggestionIntent | null;
};

type PageMode = "create" | "view" | "edit";
type SaveStatus = "idle" | "saving" | "success" | "error";

function splitAvoidIngredients(value: string): string[] {
  return [
    ...new Set(
      value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
    ),
  ];
}

export function ProfileForm({ initialProfile, suggestionIntent = null }: ProfileFormProps) {
  const suggestedDraft = applyProfileSuggestionIntent(initialProfile, suggestionIntent);
  const [profile, setProfile] = useState(initialProfile);
  const [draft, setDraft] = useState(suggestedDraft);
  const [avoidIngredientsText, setAvoidIngredientsText] = useState(
    suggestedDraft.avoid_ingredients.join(", "),
  );
  const [mode, setMode] = useState<PageMode>(
    initialProfile.onboarding_completed_at ? suggestionIntent ? "edit" : "view" : "create",
  );
  const [baselineSelected, setBaselineSelected] = useState(
    Boolean(initialProfile.onboarding_completed_at),
  );
  const [sensitivitySelected, setSensitivitySelected] = useState(
    Boolean(initialProfile.onboarding_completed_at),
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState("");
  const isCreateMode = mode === "create";

  function beginEdit() {
    setDraft(profile);
    setAvoidIngredientsText(profile.avoid_ingredients.join(", "));
    setBaselineSelected(true);
    setSensitivitySelected(true);
    setStatus("idle");
    setMessage("");
    setMode("edit");
  }

  function cancelEdit() {
    setDraft(profile);
    setAvoidIngredientsText(profile.avoid_ingredients.join(", "));
    setStatus("idle");
    setMessage("");
    setMode("view");
  }

  function toggleSkinGoal(goal: (typeof SKIN_GOALS)[number]) {
    setDraft((current) => ({
      ...current,
      skin_goals: current.skin_goals.includes(goal)
        ? current.skin_goals.filter((item) => item !== goal)
        : [...current.skin_goals, goal],
    }));
  }

  async function saveProfile() {
    if (isCreateMode && (!baselineSelected || !sensitivitySelected)) {
      setStatus("error");
      setMessage("请先选择你平时的肤质和长期敏感倾向。");
      return;
    }

    setStatus("saving");
    setMessage("");
    const input: ProfileInput = {
      skin_type: draft.skin_type,
      sensitivity_level: draft.sensitivity_level,
      skin_goals: draft.skin_goals,
      long_term_skin_baseline: draft.long_term_skin_baseline,
      preferred_routine_length: draft.preferred_routine_length,
      texture_preferences: draft.texture_preferences,
      avoid_ingredients: splitAvoidIngredients(avoidIngredientsText),
      timezone: draft.timezone,
      location: draft.location,
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
      setDraft(savedProfile);
      setAvoidIngredientsText(savedProfile.avoid_ingredients.join(", "));
      setStatus("success");
      setMessage("长期皮肤档案已保存。");
      setMode("view");
    } catch {
      setStatus("error");
      setMessage("网络连接失败，请稍后重试。");
    }
  }

  if (mode === "view") {
    return (
      <ProfileView
        message={message}
        onEdit={beginEdit}
        profile={profile}
      />
    );
  }

  return (
    <div className="beauty-profile-editor space-y-6">
      <section className="border-b border-border pb-6">
        <p className="text-sm font-medium text-muted-foreground">
          {isCreateMode ? "长期皮肤档案" : "编辑长期皮肤档案"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          {isCreateMode ? "先记录你的平时状态" : "更新你的长期基线"}
        </h2>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          {isCreateMode
            ? "这里记录的是你平时的大致情况，不是对今天皮肤状态的判断；之后可以随时修改。"
            : "这些是你主动填写的长期设置，不代表每天的皮肤状态。"}
        </p>
        {!isCreateMode ? (
          <Button className="mt-5" onClick={cancelEdit} type="button" variant="outline">
            取消编辑
          </Button>
        ) : null}
      </section>

      <BaselineEditor
        draft={draft}
        onBaselineChange={(skin_type) => {
          setDraft((current) => ({ ...current, skin_type }));
          setBaselineSelected(true);
        }}
        onSensitivityChange={(sensitivity_level) => {
          setDraft((current) => ({ ...current, sensitivity_level }));
          setSensitivitySelected(true);
        }}
      />
      <LongTermBaselineEditor value={draft.long_term_skin_baseline} onChange={(long_term_skin_baseline) => setDraft((current) => ({ ...current, long_term_skin_baseline }))} />

      <section className="beauty-section">
        <p className="text-sm font-medium text-muted-foreground">长期关注</p>
        <h2 className="mt-1 text-xl font-semibold">你现在最想长期关注哪些问题？</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          可以多选；它们是你的个人关注重点，不是皮肤诊断。
        </p>
        <fieldset className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">长期关注</legend>
          {SKIN_GOALS.map((goal) => (
            <ChoiceField
              checked={draft.skin_goals.includes(goal)}
              key={goal}
              label={skinGoalLabels[goal]}
              onChange={() => toggleSkinGoal(goal)}
            />
          ))}
        </fieldset>
      </section>

      <section className="beauty-section">
        <p className="text-sm font-medium text-muted-foreground">我的避用</p>
        <h2 className="mt-1 text-xl font-semibold">有没有你明确想避开的成分或东西？</h2>
        <AvoidIngredientsField
          onChange={setAvoidIngredientsText}
          value={avoidIngredientsText}
        />
      </section>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex flex-col gap-3 border-t border-border/80 bg-background/95 px-1 py-4 backdrop-blur-md sm:static sm:flex-row sm:items-center sm:justify-between lg:bottom-0">
        <p
          aria-live="polite"
          className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        >
          {message ||
            (isCreateMode
              ? "完成后会生成可随时编辑的长期皮肤档案。"
              : "保存后将回到档案查看页。")}
        </p>
        <Button
          className="h-10 px-5"
          disabled={status === "saving"}
          onClick={saveProfile}
          type="button"
        >
          <BeautyNavIcon name="save" size={16} />
          {status === "saving"
            ? "正在保存…"
            : isCreateMode
              ? "保存长期皮肤档案"
              : "保存修改"}
        </Button>
      </div>
    </div>
  );
}

function BaselineEditor({
  draft,
  onBaselineChange,
  onSensitivityChange,
}: {
  draft: Profile;
  onBaselineChange: (skinType: NonNullable<Profile["skin_type"]>) => void;
  onSensitivityChange: (level: number) => void;
}) {
  return (
    <>
      <section className="beauty-section first:border-t-0 first:pt-0">
        <p className="text-sm font-medium text-muted-foreground">你的长期基线</p>
        <h2 className="mt-1 text-xl font-semibold">你的皮肤平时更接近哪一种？</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          按你平时大多数时候的感受选择，之后可以随时修改。
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {baselineOptions.map((option) => (
            <RadioCard
              checked={draft.skin_type === option.value}
              key={option.value}
              label={option.label}
              name="skin-type"
              onChange={() => onBaselineChange(option.value)}
            />
          ))}
        </div>
      </section>

      <section className="beauty-section">
        <p className="text-sm font-medium text-muted-foreground">长期敏感倾向</p>
        <h2 className="mt-1 text-xl font-semibold">平时容易出现不舒服吗？</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          这里说的是反复出现的刺痛、发痒、灼热或明显刺激感，不会根据泛红来判断。
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {sensitivityTendencyOptions.map((option) => (
            <RadioCard
              checked={draft.sensitivity_level === option.value}
              key={option.value}
              label={option.label}
              name="sensitivity-tendency"
              onChange={() => onSensitivityChange(option.value)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function ProfileView({
  profile,
  message,
  onEdit,
}: {
  profile: Profile;
  message: string;
  onEdit: () => void;
}) {
  return (
    <article className="beauty-profile-record">
      <section className="beauty-profile-intro">
        <dl className="beauty-profile-baseline">
          <SummaryItem label="平时肤质" value={baselineLabel(profile.skin_type)} />
          <SummaryItem
            label="长期敏感倾向"
            value={sensitivityTendencyLabel(profile.sensitivity_level)}
          />
        </dl>
        <Button className="beauty-profile-edit rounded-full" onClick={onEdit} type="button" variant="outline"><BeautyNavIcon name="edit" size={16} />编辑档案</Button>
      </section>
      <LongTermBaselineSummary value={profile.long_term_skin_baseline} />

      {message ? (
        <p aria-live="polite" className="border-l-2 border-selected-border px-4 py-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}

      <section className="beauty-profile-footnote">
        <p className="beauty-meta">长期关注</p>
        <h2 className="beauty-section-title mt-1">我想持续关注</h2>
        {profile.skin_goals.length ? (
          <p className="mt-4 max-w-[68ch] text-sm leading-7">
            {profile.skin_goals.map((goal) => skinGoalLabels[goal]).join("、")}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            暂未选择长期关注，可以在编辑档案时补充。
          </p>
        )}
      </section>

      {profile.avoid_ingredients.length ? (
        <section className="beauty-profile-footnote">
          <p className="beauty-meta">我的避用</p>
          <h2 className="beauty-section-title mt-1">明确想避开的成分或东西</h2>
          <p className="mt-4 text-sm leading-6">{profile.avoid_ingredients.join("、")}</p>
        </section>
      ) : null}

    </article>
  );
}

function RadioCard({ checked, label, name, onChange }: { checked: boolean; label: string; name: string; onChange: () => void }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm transition-colors ${checked ? "border-selected-border bg-selected text-selected-foreground" : "border-border/80 bg-card hover:border-ring/40 hover:bg-secondary/50"}`}>
      <input checked={checked} name={name} onChange={onChange} type="radio" />
      {label}
    </label>
  );
}

function ChoiceField({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return <label className="beauty-choice-row"><input checked={checked} onChange={onChange} type="checkbox" />{label}</label>;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div><dt className="beauty-meta text-brand-deep">{label}</dt><dd>{value}</dd></div>;
}

function AvoidIngredientsField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="mt-4 block space-y-2 text-sm font-medium"><span className="sr-only">避用成分或东西</span><textarea className="beauty-field min-h-24 py-3 font-normal" onChange={(event) => onChange(event.target.value)} placeholder="如有，请用逗号或换行分隔；没有可留空" value={value} /></label>;
}

function parseProfileResponse(value: unknown): Profile | null {
  if (typeof value !== "object" || value === null || !("data" in value)) return null;
  const result = profileSchema.safeParse(value.data);
  return result.success ? result.data : null;
}
