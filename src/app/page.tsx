import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth/get-current-user";

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/app");
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-6 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,oklch(0.94_0.035_345),transparent_38%),radial-gradient(circle_at_bottom_right,oklch(0.94_0.035_210),transparent_42%)]" />

      <section className="relative w-full max-w-3xl rounded-3xl border bg-card/90 p-8 shadow-sm backdrop-blur sm:p-12">
        <p className="mb-5 text-sm font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Personal Beauty Management
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Beauty OS
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          管理已经拥有的护肤和彩妆资产，让每天使用什么，比继续购买什么更清楚。
        </p>

        <div className="mt-10 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            从已有产品出发，记录每天的皮肤变化与真实使用感受。
          </p>
          <Button nativeButton={false} render={<Link href="/login" />}>进入 Beauty OS</Button>
        </div>
      </section>
    </main>
  );
}
