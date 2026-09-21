"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export function AppRouteError({ retry }: { retry: () => void }) {
  return (
    <main className="beauty-page max-w-3xl">
      <section className="border-t border-border/80 pt-6 sm:pt-8">
        <p className="text-sm font-medium text-destructive">页面暂时无法打开</p>
        <h1 className="beauty-page-title mt-2">刚刚加载时出了点问题</h1>
        <p className="beauty-helper mt-3">可以重试一次，或先返回首页。你的已保存数据不会因此改变。</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={retry} type="button">重新加载</Button>
          <Button nativeButton={false} render={<Link href="/app" />} variant="outline">返回首页</Button>
        </div>
      </section>
    </main>
  );
}
