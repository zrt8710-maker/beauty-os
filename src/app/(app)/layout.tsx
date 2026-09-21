import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { BeautyNavIcon } from "@/components/beauty-nav-icon";
import { MobileAppHeader } from "@/components/mobile-app-header";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { SidebarEnvironmentEntry } from "@/features/weather/sidebar-environment-entry";
import { getAppShellContext } from "@/server/app-shell/app-shell-context";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { signOut } from "@/server/auth/sign-out";

export default async function ProtectedAppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-svh bg-background pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:pb-0">
      <aside className="sticky top-0 hidden h-svh flex-col border-r bg-sidebar lg:flex">
        <div className="beauty-sidebar-account border-b border-sidebar-border px-5 py-5">
          <p className="font-semibold tracking-tight">Beauty OS</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{user.email ?? "已登录"}</p>
        </div>
        <PrimaryNavigation />
        <div className="mt-auto">
          {user.appRole === "admin" ? (
            <div className="px-5 py-3">
              <Link className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" href="/admin/knowledge">
                <BeautyNavIcon name="knowledge" size={16} />知识库管理
              </Link>
            </div>
          ) : null}
          <div className="space-y-4 border-t p-4">
            <Suspense fallback={<div aria-busy="true" aria-label="正在加载环境信息" className="h-16 animate-pulse rounded-xl bg-muted" />}>
              <SidebarWeather userId={user.id} />
            </Suspense>
            <form action={signOut}>
              <Button className="w-full" type="submit" variant="outline">退出登录</Button>
            </form>
          </div>
        </div>
      </aside>
      <div className="beauty-app-content min-w-0">
        <header className="border-b border-sidebar-border bg-sidebar lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <MobileAppHeader />
            <div className="flex items-center gap-2">
              <Link aria-label="返回首页查看提醒" className="beauty-icon-control" href="/app">
                <BeautyNavIcon name="notification" size={20} />
              </Link>
              <form action={signOut}>
                <Button className="px-3" type="submit" variant="ghost">退出</Button>
              </form>
            </div>
          </div>
        </header>
        {children}
      </div>
      <PrimaryNavigation mobile />
    </div>
  );
}

// Weather retains its full refresh behavior, but cannot hold up the app shell.
async function SidebarWeather({ userId }: { userId: string }) {
  const shell = await getAppShellContext(userId);
  return (
    <SidebarEnvironmentEntry
      humidity={shell.weather?.humidity ?? null}
      locationLabel={shell.profileRow?.location_name ?? null}
      temperature={shell.weather?.temperature ?? null}
      uvIndex={shell.weather?.uv_index ?? null}
    />
  );
}
