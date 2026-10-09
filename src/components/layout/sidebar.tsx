"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  LayoutDashboard,
  MessageSquare,
  PieChart,
  SquareUser,
  Users,
  ListTodo,
  SquareKanban,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui";
import type { SessionUser } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/board", label: "Board", icon: SquareKanban },
  { href: "/chat", label: "Team chat", icon: MessageSquare },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/reports", label: "Reports", icon: PieChart },
  { href: "/activity", label: "Activity log", icon: Activity },
  { href: "/profile", label: "My profile", icon: SquareUser },
];

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const { sidebarOpen, setSidebar } = useUiStore();

  return (
    <>
      {sidebarOpen ? (
        <button
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-panel transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/dashboard" className="block" onClick={() => setSidebar(false)}>
            <p className="font-mono text-[11px] tracking-[0.18em] text-teal">VSS PULSE</p>
            <p className="text-lg font-semibold leading-tight">Employee Management</p>
          </Link>
          <button className="lg:hidden" onClick={() => setSidebar(false)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebar(false)}
                className={cn(
                  "flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition",
                  active
                    ? "border-copper bg-paper text-ink"
                    : "border-transparent text-muted hover:bg-paper hover:text-ink"
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line px-5 py-4">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate font-mono text-xs capitalize text-muted">{user.role.replace("_", " ")}</p>
        </div>
      </aside>
    </>
  );
}
