"use client";

import type { ReactNode } from "react";

/**
 * Dashboard summary card used by every module. With `onClick` it is a button that applies the matching list filter
 * (clicking the active card again clears it); without it, it is a plain read-only card.
 */
export default function StatCard({
  label, value, sub, tone, active, onClick, title, valueClassName,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** extra classes for colour: "accent", "stat-ok", "stat-bad", "stat-av-green", "stat-av-blue", "stat-av-red" */
  tone?: string;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  valueClassName?: string;
}) {
  const cls = `stat${tone ? ` ${tone}` : ""}${onClick ? " stat-click" : ""}${active ? " is-active" : ""}`;
  const body = (
    <>
      <span>{label}</span>
      <strong className={valueClassName}>{value}</strong>
      {sub && <small className="muted">{sub}</small>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-pressed={!!active} title={title ?? `Show ${label.toLowerCase()}`}>
      {body}
    </button>
  ) : (
    <div className={cls} title={title}>{body}</div>
  );
}
