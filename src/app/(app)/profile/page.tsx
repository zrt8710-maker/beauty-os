import { redirect } from "next/navigation";

import { ProfileForm } from "@/features/profile/profile-form";
import { parseProfileSuggestionIntent } from "@/features/profile/profile-suggestion-intent";
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
      <ProfileForm initialProfile={profile} suggestionIntent={suggestionIntent} />
    </main>
  );
}
