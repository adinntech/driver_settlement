"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const VEHICLE_TABS = [
  { href: "/rbp/vehicles", label: "Vehicle Management" },
  { href: "/rbp/vehicles/allotment", label: "Vehicle Allotment" },
  { href: "/rbp/vehicles/allotment-history", label: "Allotment History" },
] as const;

/** Which tab a path belongs to (the add / edit / view pages belong to the first tab). */
export function activeTab(pathname: string): string {
  if (pathname.startsWith("/rbp/vehicles/allotment-history")) return "/rbp/vehicles/allotment-history";
  if (pathname.startsWith("/rbp/vehicles/allotment")) return "/rbp/vehicles/allotment";
  return "/rbp/vehicles";
}

export function VehicleTabsView({ active }: { active: string }) {
  return (
    <nav className="v-tabs" aria-label="Vehicle Management sections">
      {VEHICLE_TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`v-tab${t.href === active ? " active" : ""}`} aria-current={t.href === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export default function VehicleTabs() {
  return <VehicleTabsView active={activeTab(usePathname() ?? "")} />;
}
