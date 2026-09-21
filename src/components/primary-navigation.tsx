"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BeautyNavIcon, type BeautyNavIconName } from "@/components/beauty-nav-icon";
import { cn } from "@/lib/utils";

export function PrimaryNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  if (mobile) {
    const items = [
      { href: "/app", label: "首页", icon: "home" as const, active: pathname === "/app" },
      { href: "/today/am", label: "今日", icon: "today" as const, active: pathname.startsWith("/today") },
      { href: "/inventory", label: "资产", icon: "inventory" as const, active: pathname === "/inventory" },
      { href: "/check-in", label: "皮肤", icon: "daily-skin" as const, active: pathname === "/check-in" },
      { href: "/profile", label: "我的", icon: "profile" as const, active: pathname === "/profile" || pathname === "/preferences" },
    ];
    return (
      <nav aria-label="移动端主要导航" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border/80 bg-[var(--surface-mobile-nav)] px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
        {items.map((item) => (
          <Link aria-current={item.active ? "page" : undefined} className={cn("beauty-nav-item flex min-h-16 touch-manipulation flex-col items-center justify-center gap-1 border-t-2 px-1 text-[11px] font-medium", item.active ? "border-selected-border bg-selected/70 text-selected-foreground" : "border-transparent text-muted-foreground")} href={item.href} key={item.href}>
            <BeautyNavIcon active={item.active} name={item.icon} size={20} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    );
  }
  const linkClass = (active: boolean, nested = false) => cn(
    "beauty-nav-item flex touch-manipulation items-center rounded-xl hover:bg-sidebar-accent active:bg-selected/70",
    nested ? "min-h-10 px-3 py-1.5 text-xs" : "min-h-11 gap-3 px-3 py-2 text-sm font-medium",
    active ? "border border-selected-border bg-selected text-selected-foreground" : nested ? "text-muted-foreground hover:text-foreground" : null,
  );

  return (
    <nav aria-label="主要导航" className="flex flex-col gap-1 p-3">
      <NavLink active={pathname === "/app"} href="/app" icon="home" label="首页" linkClass={linkClass} />
      <details className="group" open={pathname.startsWith("/today") || undefined}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 active:bg-selected/70">
          <BeautyNavIcon active={pathname.startsWith("/today")} name="today" size={20} />
          <span className="flex-1">今日方案</span>
          <span aria-hidden="true" className="beauty-disclosure text-xs text-muted-foreground group-open:rotate-180">▴</span>
        </summary>
        <div className="ml-5 border-l pl-2">
          <Link aria-current={pathname === "/today/am" ? "page" : undefined} className={linkClass(pathname === "/today/am", true)} href="/today/am"><BeautyNavIcon active={pathname === "/today/am"} name="am" size={16} />AM 早间方案</Link>
          <Link aria-current={pathname === "/today/pm" ? "page" : undefined} className={linkClass(pathname === "/today/pm", true)} href="/today/pm"><BeautyNavIcon active={pathname === "/today/pm"} name="pm" size={16} />PM 晚间方案</Link>
        </div>
      </details>
      <NavLink active={pathname === "/inventory"} href="/inventory" icon="inventory" label="我的资产" linkClass={linkClass} />
      <div className="mt-3 border-t pt-3">
        <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">皮肤</p>
        <NavLink active={pathname === "/profile"} href="/profile" icon="profile" label="长期档案" linkClass={linkClass} />
        <NavLink active={pathname === "/check-in"} href="/check-in" icon="daily-skin" label="今日状态" linkClass={linkClass} />
        <NavLink active={pathname === "/preferences"} href="/preferences" icon="care-preferences" label="护理偏好" linkClass={linkClass} />
      </div>
    </nav>
  );
}

function NavLink({ active, href, icon, label, linkClass }: { active: boolean; href: string; icon: BeautyNavIconName; label: string; linkClass: (active: boolean, nested?: boolean) => string }) {
  return <Link aria-current={active ? "page" : undefined} className={linkClass(active)} href={href}><BeautyNavIcon active={active} name={icon} size={20} /><span>{label}</span></Link>;
}
