"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BeautyNavIcon } from "@/components/beauty-nav-icon";

const routeTitles: Array<[string, string]> = [
  ["/admin/knowledge", "知识库"], ["/usage-feedback", "用后反馈"],
  ["/purchase-advisor", "购买判断"], ["/preferences", "护理偏好"],
  ["/check-in", "每日皮肤"], ["/inventory", "美妆资产"],
  ["/profile", "长期档案"], ["/today", "今日方案"], ["/app", "首页"],
];

export function MobileAppHeader() {
  const pathname = usePathname();
  const title = routeTitles.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Beauty OS";
  const backHref = pathname.startsWith("/usage-feedback") ? "/today/am"
    : pathname.startsWith("/preferences") ? "/profile"
      : pathname.startsWith("/admin/knowledge/") ? "/admin/knowledge"
        : null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      {backHref ? (
        <Link aria-label="返回上一层" className="beauty-icon-control" href={backHref}>
          <BeautyNavIcon name="back" size={20} />
        </Link>
      ) : null}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Beauty OS</p>
        <p className="truncate text-sm font-semibold tracking-tight">{title}</p>
      </div>
    </div>
  );
}
