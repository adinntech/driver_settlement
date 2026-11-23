"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import type { RoleKey } from "@/types/domain";
import { homeFor } from "@/utils/budgetDescribe";
import NotificationBell from "@/components/NotificationBell";
import { Skeleton } from "@/components/ui/Ui";

// Modular navigation: add an entry per role to onboard new modules.
const NAV: Record<RoleKey, { href: string; label: string }[]> = {
  RSOP: [
    { href: "/rsop", label: "Dashboard" },
    { href: "/rsop/new", label: "New Tracking Request" },
  ],
  RBP: [
    { href: "/rbp", label: "Projects & Budgets" },
    { href: "/rbp/vehicles", label: "Vehicle Management" },
  ],
  RSOM: [{ href: "/rsom", label: "Budget Approvals" }],
};

/** Exact match, or a sub-page of this entry unless another entry matches more specifically. */
function isActive(path: string, href: string, all: { href: string }[]): boolean {
  if (path === href) return true;
  if (!path.startsWith(`${href}/`)) return false;
  return !all.some((o) => o.href !== href && o.href.length > href.length && (path === o.href || path.startsWith(`${o.href}/`)));
}

export default function AppShell({ role, children }: { role: RoleKey; children: ReactNode }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/login");
    else if (user.role !== role) router.replace(homeFor(user.role));
  }, [ready, user, role, router]);

  if (!ready || !user || user.role !== role)
    return (
      <div className="boot">
        <Skeleton rows={3} />
      </div>
    );

  return (
    <div className="app">
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">DS</span>
          <div>
            <strong>Driver Settlement</strong>
            <small>{role} workspace</small>
          </div>
        </div>
        <nav>
          {NAV[role].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={isActive(path, n.href, NAV[role]) ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="avatar">{user.username[0]}</span>
            <div>
              <strong>{user.username}</strong>
              <small>{role}</small>
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="content">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <span className="muted">Signed in as {user.username}</span>
          <span className="topbar-spacer" />
          <NotificationBell />
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
