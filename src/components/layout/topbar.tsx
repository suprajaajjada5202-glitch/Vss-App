"use client";

import { Bell, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { signOut } from "@/lib/actions/profile";
import { useUiStore } from "@/store/ui";
import { useNotificationStore } from "@/store/notifications";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/types";

export function Topbar({ user, unread: serverUnread }: { user: SessionUser; unread: number }) {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = useUiStore((s) => s.toggleSidebar);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [signingOut, startSignOut] = useTransition();
  // The inbox updates this store optimistically; the server value re-syncs it whenever it changes.
  const syncUnread = useNotificationStore((s) => s.sync);
  const storedUnread = useNotificationStore((s) => s.unread);
  useEffect(() => syncUnread(serverUnread), [serverUnread, syncUnread]);
  const unread = storedUnread ?? serverUnread;

  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-panel/90 px-3 py-3 backdrop-blur sm:gap-3 sm:px-4">
      <button className="p-1 lg:hidden" onClick={toggle} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <button
        className="hidden h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-ink lg:flex"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand menu" : "Collapse menu"}
      >
        {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
      </button>
      <form
        role="search"
        className="relative min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.trim()) return;
          router.push(`/employees?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search employees"
          aria-label="Search employees"
          className="h-10 w-full rounded-sm border border-line bg-paper pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </form>
      <button
        className="flex h-10 w-10 shrink-0 items-center justify-center border border-line"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        aria-label="Toggle dark mode"
      >
        <Sun size={16} className="hidden dark:block" />
        <Moon size={16} className="dark:hidden" />
      </button>
      <Link
        href="/notifications"
        className="relative flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-sm"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell size={16} />
        <span className="hidden sm:inline">Notifications</span>
        {unread > 0 ? (
          <span className="bg-copper px-1.5 font-mono text-[10px] text-white">{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </Link>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={signingOut}
        onClick={() =>
          startSignOut(async () => {
            await signOut();
            router.push("/login");
            router.refresh();
          })
        }
      >
        Sign out
      </Button>
      <span className="hidden font-mono text-xs text-muted xl:inline">{user.employeeCode}</span>
    </header>
  );
}
