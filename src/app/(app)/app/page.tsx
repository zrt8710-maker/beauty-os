import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/get-current-user";

export default async function AppHomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <section className="rounded-3xl border bg-card p-8 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          Coding Step 4
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          管理你的美妆资产
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
          手动记录你已经拥有的产品、库存状态和剩余量。AI、图片与推荐功能尚未创建。
        </p>
      </section>
    </main>
  );
}
