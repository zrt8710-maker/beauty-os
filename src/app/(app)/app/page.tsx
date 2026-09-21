import { Suspense } from "react";
import { redirect } from "next/navigation";

import { HomeAttentionNotification } from "@/features/home/home-attention";
import { buildHomeAttentionItems } from "@/features/home/home-attention-view-model";
import { deriveInventoryQuantityAttention } from "@/features/home/inventory-quantity-attention";
import type { HomeFeedbackRoutine } from "@/features/home/home-feedback-action";
import { SkinConversation } from "@/features/skin-conversation/skin-conversation";
import { createClient } from "@/lib/supabase/server";
import { getProfileContext } from "@/server/app-shell/app-shell-context";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createUsageRepository, type QuantityUsageRecord } from "@/server/repositories/usage-repository";
import { createInventoryService } from "@/server/services/inventory-service";
import { createProfileService } from "@/server/services/profile-service";
import { buildRecentSkinTrends } from "@/server/services/recent-skin-trends-service";
import { createSkinCheckinService } from "@/server/services/skin-checkin-service";
import { buildSkinProfileSuggestions } from "@/server/services/skin-profile-suggestion-service";
import type { Profile } from "@/schemas/profile";
import type { SkinCheckin } from "@/schemas/checkin";
import type { OwnedProduct } from "@/schemas/product";

export default async function AppHomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const checkinRepository = createSkinCheckinRepository(supabase);
  const routineRepository = createRoutineRepository(supabase);
  const usageRepository = createUsageRepository(supabase);
  const inventoryService = createInventoryService(
    createProductRepository(supabase),
    createOwnedProductRepository(supabase),
  );
  const shell = await getProfileContext(user.id);
  const profile = shell.profile ?? await createProfileService(createProfileRepository(supabase)).getProfile(user.id);
  const today = formatDateInTimeZone(new Date(), profile.timezone);
  const homeDataPromise = Promise.all([
    createSkinCheckinService(checkinRepository).listCheckins(user.id, { limit: 30 }),
    inventoryService.listOwnedProducts(user.id, {}),
    routineRepository.listByDate(user.id, today),
    usageRepository.listRecentQuantityUsage(user.id, addDays(today, -29)),
  ]).then(([checkins, ownedProducts, routines, quantityUsage]) => ({
    checkins,
    ownedProducts,
    quantityUsage,
    feedbackRoutines: routines.map((routine) => ({ id: routine.id, period: routine.period as HomeFeedbackRoutine["period"], status: routine.status })),
  }));

  return (
    <main className="beauty-home-canvas flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col overflow-hidden px-4 pb-4 pt-9 sm:px-6 lg:h-svh lg:px-0 lg:pb-5 lg:pt-14">
      <Suspense fallback={<HomeAssistantFallback />}>
        <HomeContent
          homeDataPromise={homeDataPromise}
          profile={profile}
          today={today}
          userId={user.id}
        />
      </Suspense>
    </main>
  );
}

async function HomeContent({
  homeDataPromise,
  profile,
  today,
  userId,
}: {
  homeDataPromise: Promise<{ checkins: SkinCheckin[]; ownedProducts: OwnedProduct[]; feedbackRoutines: HomeFeedbackRoutine[]; quantityUsage: QuantityUsageRecord[] }>;
  profile: Profile;
  today: string;
  userId: string;
}) {
  const { checkins, ownedProducts, feedbackRoutines, quantityUsage } = await homeDataPromise;
  const attentionItems = buildHomeAttentionItems({
    today,
    ownedProducts,
    profileSuggestions: buildSkinProfileSuggestions(profile, checkins.slice(0, 28), today),
    quantityAttention: deriveInventoryQuantityAttention({
      ownedProducts,
      recentUsage: quantityUsage,
      timeZone: profile.timezone,
      today,
    }),
  }).slice(0, 2);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[940px] flex-1 flex-col lg:mx-0 lg:ml-20 lg:mr-auto">
      <SkinConversationSection
        attentionItems={attentionItems}
        checkins={checkins}
        feedbackRoutines={feedbackRoutines}
        profile={profile}
        today={today}
        userId={userId}
      />
    </div>
  );
}

function SkinConversationSection({
  attentionItems,
  checkins,
  feedbackRoutines,
  profile,
  today,
  userId,
}: {
  attentionItems: Parameters<typeof HomeAttentionNotification>[0]["items"];
  checkins: SkinCheckin[];
  feedbackRoutines: HomeFeedbackRoutine[];
  profile: Profile;
  today: string;
  userId: string;
}) {
  const recentTrends = buildRecentSkinTrends(checkins, today);
  return (
    <div className="flex min-h-0 flex-1 flex-col" id="daily-skin">
      <SkinConversation
        isDevelopment={process.env.NODE_ENV === "development"}
        feedbackRoutines={feedbackRoutines}
        presentation="home"
        profile={{ skin_type: profile.skin_type, long_term_skin_baseline: profile.long_term_skin_baseline }}
        recentTrends={recentTrends}
        today={today}
        topActions={<HomeAttentionNotification items={attentionItems} />}
        userId={userId}
      />
    </div>
  );
}

function HomeAssistantFallback() {
  return <section aria-label="正在加载 Beauty OS Assistant" className="min-h-[28rem] flex-1 animate-pulse" />;
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
