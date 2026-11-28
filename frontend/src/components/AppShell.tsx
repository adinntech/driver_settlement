"use client";

import Link from "next/link";
import { BASE_PATH } from "@/utils/config";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import type { RoleKey } from "@/types/domain";
import { homeFor } from "@/utils/budgetDescribe";
import NotificationBell from "@/components/NotificationBell";
import RejectedBadge from "@/components/RejectedBadge";
import { Skeleton } from "@/components/ui/Ui";
import { useNetworkActivity } from "@/hooks/useApi";

// Modular navigation: add an entry per role to onboard new modules.
export const NAV: Record<RoleKey, { href: string; label: string }[]> = {
  RSOP: [
    { href: "/rsop", label: "Dashboard" },
    { href: "/rsop/new", label: "New Tracking Request" },
  ],
  RBP: [
    { href: "/rbp", label: "Projects & Budgets" },
    { href: "/rbp/vehicles", label: "Vehicle Management" },
    { href: "/rbp/drivers", label: "Driver Management" },
    { href: "/rbp/on-road", label: "Vehicle Deliver" },
    { href: "/rbp/on-road-vehicles", label: "On Road Vehicles" },
    { href: "/rbp/payments", label: "Driver Payments" },
  ],
  RSOM: [
    { href: "/rsom", label: "Budget Approvals" },
    { href: "/rsom/payments", label: "Daily Payment Approvals" },
  ],
  RSA: [
    { href: "/rsa", label: "Payments" },
    { href: "/rsa/clearance", label: "Vehicle & Driver Clearance" },
    { href: "/rsa/on-road-vehicles", label: "On Road Vehicles" },
    { href: "/rsa/driver-payments", label: "Driver Payments" },
    { href: "/rsa/settlements/completed", label: "Payment Completed" },
    { href: "/rsa/iocl-data", label: "IOCL Data" },
  ],
  RSO: [
    { href: "/rso", label: "Final Settlement Approvals" },
    { href: "/rso/reports", label: "Reports" },
  ],
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
  const [signingOut, setSigningOut] = useState(false);
  const busy = useNetworkActivity() > 0;

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE_PATH}/adinn-logo.png`} alt="Adinn Advertising Services" className="brand-logo" />
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
              {role === "RBP" && n.href === "/rbp" && <RejectedBadge />}
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
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              logout(); // clears the session and loads /login
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className={`net-bar${busy ? " is-on" : ""}`} role="progressbar" aria-hidden={!busy} aria-label="Loading" />
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
