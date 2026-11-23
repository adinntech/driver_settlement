"use client";

import Link from "next/link";
import { DriverAvBadge } from "@/components/DriverAvailability";
import type { Driver } from "@/types/domain";
import { DRIVER_AV_LABEL, DRIVER_AV_STATUSES, driverAvailabilityDates, driverProjectName } from "@/utils/driverAvailability";
import { DRIVER_TYPE_LABEL } from "@/utils/driverForm";

/** Listing columns: only the essentials. Everything else is on the View page. */
export const DRIVER_LIST_COLUMNS = ["Driver No", "Driver Name", "Mobile No", "Driver Type", "Availability Status", "Project Name", "Available From / To", "Actions"] as const;

export function DriverTable({ items }: { items: Driver[] }) {
  return (
    <div className="table-wrap">
      <table className="table drv-list">
        <thead>
          <tr>{DRIVER_LIST_COLUMNS.map((c) => <th key={c}>{c === "Actions" ? <span className="sr-only">{c}</span> : c}</th>)}</tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d._id}>
              <td><strong className="num">{d.driverNumber}</strong></td>
              <td>{d.driverName}</td>
              <td>{d.mobileNumber}</td>
              <td>{DRIVER_TYPE_LABEL[d.driverType]}</td>
              <td><DriverAvBadge status={d.availability?.status} /></td>
              <td>{driverProjectName(d.availability)}</td>
              <td>{driverAvailabilityDates(d.availability)}</td>
              <td>
                <div className="inline row-actions">
                  <Link href={`/rbp/drivers/view?id=${d._id}`} className="btn btn-outline btn-sm">View</Link>
                  <Link href={`/rbp/drivers/edit?id=${d._id}`} className="btn btn-outline btn-sm">Edit</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One mass search box + one availability-status filter + Clear Filters. Controlled: the page owns the state. */
export function DriverFilters({
  q, status, onQ, onStatus, onClear,
}: { q: string; status: string; onQ: (v: string) => void; onStatus: (v: string) => void; onClear: () => void }) {
  return (
    <div className="filters-vehicle drv-filters">
      <input className="search-wide" placeholder="Search driver no, name, mobile, licence no, project name, trackup / PIF no" value={q}
        onChange={(e) => onQ(e.target.value)} aria-label="Mass search" />
      <select value={status} onChange={(e) => onStatus(e.target.value)} aria-label="Availability status filter">
        <option value="">All</option>
        {DRIVER_AV_STATUSES.map((s) => <option key={s} value={s}>{DRIVER_AV_LABEL[s]}</option>)}
      </select>
      <button type="button" className="btn btn-outline" onClick={onClear} disabled={!q && !status}>Clear Filters</button>
    </div>
  );
}
