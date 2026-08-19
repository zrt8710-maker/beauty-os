import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
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
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 lg:flex lg:items-center lg:justify-between lg:py-4">
          <div className="min-w-0 lg:flex lg:items-center lg:gap-6">
            <div className="flex items-center justify-between gap-3 lg:block">
              <div className="min-w-0">
              <p className="font-semibold tracking-tight">Beauty OS</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email ?? "已登录"}
              </p>
              </div>
              <form action={signOut} className="lg:hidden">
                <Button type="submit" variant="outline">
                  退出登录
                </Button>
              </form>
            </div>
            <nav aria-label="主要导航" className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-1 text-sm sm:-mx-6 sm:px-6 lg:mx-0 lg:mt-0 lg:overflow-visible lg:px-0 lg:pb-0">
              <Button className="shrink-0" render={<Link href="/app" />} variant="ghost">
                首页
              </Button>
              <Button className="shrink-0" render={<Link href="/profile" />} variant="ghost">
                皮肤档案
              </Button>
              <Button className="shrink-0" render={<Link href="/check-in" />} variant="ghost">
                今日记录
              </Button>
              <Button className="shrink-0" render={<Link href="/today" />} variant="ghost">
                今日方案
              </Button>
              <Button className="shrink-0" render={<Link href="/inventory" />} variant="ghost">
                美妆资产
              </Button>
              <Button className="shrink-0" render={<Link href="/product-drafts" />} variant="ghost">
                产品草稿
              </Button>
              <Button className="shrink-0" render={<Link href="/purchase-advisor" />} variant="ghost">
                购买判断
              </Button>
            </nav>
          </div>
          <form action={signOut} className="hidden lg:block">
            <Button type="submit" variant="outline">
              退出登录
            </Button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
