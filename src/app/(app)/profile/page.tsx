import { redirect } from "next/navigation";

import { ProfileForm } from "@/features/profile/profile-form";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createProfileService } from "@/server/services/profile-service";

export default async function ProfilePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const repository = createProfileRepository(supabase);
  const service = createProfileService(repository);
  const profile = await service.getProfile(user.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">
          Beauty Profile
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          我的皮肤档案
        </h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          记录长期、主动填写的肤质与护肤偏好。这里不进行 AI 或图片皮肤分析。
        </p>
      </div>
      <ProfileForm initialProfile={profile} />
    </main>
  );
}
