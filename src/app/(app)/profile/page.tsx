import { redirect } from "next/navigation";
import Link from "next/link";

import { ProfileForm } from "@/features/profile/profile-form";
import { parseProfileSuggestionIntent } from "@/features/profile/profile-suggestion-intent";
import { getSetupStatus } from "@/features/profile/setup-status";
import { WeatherLocationSettings } from "@/features/weather/weather-location-settings";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getProfileContext } from "@/server/app-shell/app-shell-context";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createProfileService } from "@/server/services/profile-service";

type ProfilePageProps = { searchParams: Promise<{ suggestion?: string | string[]; concern?: string | string[]; area?: string | string[] }> };

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const repository = createProfileRepository(supabase);
  const service = createProfileService(repository);
  const shell = await getProfileContext(user.id);
  const profile = shell.profile ?? await service.getProfile(user.id);
  const suggestionIntent = parseProfileSuggestionIntent(await searchParams);
  const setup = getSetupStatus(shell.profileRow);
  const incomplete = !setup.profile || !setup.city || !setup.preferences;

  return (
    <main className="beauty-ambient-page beauty-ambient-profile beauty-page min-h-svh">
      <div className="beauty-page-header">
        <h1 className="beauty-page-title">
          我的皮肤档案
        </h1>
        <p className="beauty-copy mt-3">
          记录你平时的皮肤基线和长期关注；每日波动请前往皮肤状态记录。
        </p>
      </div>
      {incomplete ? <section aria-label="首次使用设置" className="mb-6 rounded-2xl border border-selected-border bg-selected/60 p-5">
        <h2 className="text-lg font-semibold">先完善这些信息，方案会更贴合你</h2>
        <p className="mt-1 text-sm text-muted-foreground">可以分次完成；每项保存后，对应提醒就会消失。</p>
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          {!setup.profile ? <li><a className="rounded-full border bg-card px-3 py-2" href="#profile-form">① 保存长期档案</a></li> : null}
          {!setup.city ? <li>{setup.profile ? <a className="rounded-full border bg-card px-3 py-2" href="#city-settings">② 设置所在城市</a> : <span className="rounded-full border bg-card/60 px-3 py-2 text-muted-foreground">② 保存档案后设置城市</span>}</li> : null}
          {!setup.preferences ? <li>{setup.profile ? <Link className="rounded-full border bg-card px-3 py-2" href="/preferences">③ 保存护理偏好</Link> : <span className="rounded-full border bg-card/60 px-3 py-2 text-muted-foreground">③ 保存档案后设置护理偏好</span>}</li> : null}
        </ul>
      </section> : null}
      <div id="profile-form">
        <ProfileForm initialProfile={profile} suggestionIntent={suggestionIntent} />
      </div>
      {setup.profile ? <details className="mt-8 rounded-2xl border border-border/70 bg-card p-5" id="city-settings" open={!setup.city}>
        <summary className="cursor-pointer font-semibold">所在城市{setup.city ? ` · ${profile.location.name}` : " · 待设置"}</summary>
        <div className="mt-4"><WeatherLocationSettings initialLocationName={profile.location.name} presentation="embedded" /></div>
      </details> : null}
    </main>
  );
}
