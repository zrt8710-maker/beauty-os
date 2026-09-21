import { redirect } from "next/navigation";

import { CarePreferencesForm } from "@/features/profile/care-preferences-form";
import { createClient } from "@/lib/supabase/server";
import { getProfileContext } from "@/server/app-shell/app-shell-context";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createProfileService } from "@/server/services/profile-service";

export default async function CarePreferencesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const shell = await getProfileContext(user.id);
  const profile = shell.profile ?? await createProfileService(
    createProfileRepository(await createClient()),
  ).getProfile(user.id);

  if (!profile.onboarding_completed_at) redirect("/profile");

  return (
    <main className="beauty-ambient-page beauty-ambient-preferences beauty-page">
      <div className="beauty-page-header">
        <p className="beauty-kicker">Care Preferences</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">护理偏好</h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          管理方案长度与使用质地偏好；这些设置不属于长期皮肤基线。
        </p>
      </div>
      <CarePreferencesForm initialProfile={profile} />
    </main>
  );
}
