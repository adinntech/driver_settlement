"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "./Select";

/**
 * Drop-in replacement for <input type="date">: the value stays "YYYY-MM-DD" (or ""), onChange(e) gets e.target.value, and
 * min / max / disabled / readOnly / required behave like the native input. Shows the app's date format (22-Oct-2026), a calendar
 * popover with month / year views, today marker, disabled out-of-range days, Clear and Today, and full keyboard support.
 */
export interface DateInputProps {
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  title?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s?: string) => (s && YMD.test(s) ? { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1, d: Number(s.slice(8, 10)) } : null);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Today in IST, the business timezone of the app. */
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const displayDate = (s?: string) => {
  const p = parse(s);
  return p ? `${pad(p.d)}-${MONTHS[p.m]}-${p.y}` : "";
};
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const addMonths = (s: string, n: number) => {
  const p = parse(s)!;
  const t = new Date(Date.UTC(p.y, p.m + n, 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth(), Math.min(p.d, daysIn(t.getUTCFullYear(), t.getUTCMonth())));
};
const fakeEvent = (value: string) =>
  ({ target: { value }, currentTarget: { value }, preventDefault() {}, stopPropagation() {} }) as unknown as ChangeEvent<HTMLInputElement>;

export default function DateInput(props: DateInputProps) {
  const { value = "", onChange, min, max, disabled, readOnly, required, name, id, className, style, placeholder = "dd-mmm-yyyy", title, autoFocus } = props;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [today, setToday] = useState("");
  const [cursor, setCursor] = useState(""); // keyboard-focused day
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, trigger, panel, 280);

  const outOfRange = useCallback((s: string) => (!!min && YMD.test(min) && s < min) || (!!max && YMD.test(max) && s > max), [min, max]);
  const close = useCallback((focus = true) => {
    setOpen(false);
    setView("days");
    if (focus) trigger.current?.focus();
  }, []);
  const openCal = () => {
    if (disabled || readOnly) return;
    const now = todayIst(); // computed when the calendar opens (client side, IST)
    setToday(now);
    const start = parse(value) ? value : now;
    setCursor(outOfRange(start) ? (min && start < min ? min : max ?? start) : start);
    setView("days");
    setOpen(true);
  };
  const pick = (s: string) => {
    if (outOfRange(s)) return;
    if (s !== value) onChange?.(fakeEvent(s));
    close();
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open, close]);

  const onKey = (e: KeyboardEvent) => {
    if (disabled || readOnly) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown"].includes(e.key)) { e.preventDefault(); openCal(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && value && !required) { e.preventDefault(); onChange?.(fakeEvent("")); }
      return;
    }
    if (view !== "days") {
      if (e.key === "Escape") { e.preventDefault(); setView("days"); }
      return;
    }
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1), ArrowRight: () => addDays(cursor, 1), ArrowUp: () => addDays(cursor, -7), ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, e.shiftKey ? -12 : -1), PageDown: () => addMonths(cursor, e.shiftKey ? 12 : 1),
      Home: () => addDays(cursor, -((new Date(`${cursor}T00:00:00Z`).getUTCDay() + 6) % 7)), End: () => addDays(cursor, 6 - ((new Date(`${cursor}T00:00:00Z`).getUTCDay() + 6) % 7)),
    };
    if (step[e.key]) { e.preventDefault(); setCursor(step[e.key]()); }
    else if (e.key === "Enter") { e.preventDefault(); pick(cursor); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
  };

  const c = parse(cursor) ?? parse(today) ?? { y: 2026, m: 0, d: 1 };
  const first = (new Date(Date.UTC(c.y, c.m, 1)).getUTCDay() + 6) % 7; // Monday-first grid
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysIn(c.y, c.m) }, (_, i) => ymd(c.y, c.m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const monthOut = (y: number, m: number) => (!!min && YMD.test(min) && ymd(y, m, daysIn(y, m)) < min) || (!!max && YMD.test(max) && ymd(y, m, 1) > max);
  const yearStart = c.y - (c.y % 12);
  const canPrev = !min || !YMD.test(min) || ymd(c.y, c.m, 1) > min;
  const canNext = !max || !YMD.test(max) || ymd(c.y, c.m, daysIn(c.y, c.m)) < max;

  return (
    <span className={`ui-date${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${readOnly ? " is-readonly" : ""}${className ? ` ${className}` : ""}`} style={style} title={title}>
      <input className="ui-native" type="date" tabIndex={-1} aria-hidden="true" value={value} min={min} max={max} name={name} required={required} disabled={disabled} readOnly
        aria-label={props["aria-label"]} />
      <button
        ref={trigger} type="button" id={id} className="ui-date-trigger" disabled={disabled} autoFocus={autoFocus} aria-haspopup="dialog" aria-expanded={open}
        aria-label={props["aria-label"] ? `${props["aria-label"]}${value ? `: ${displayDate(value)}` : ""}` : undefined} aria-describedby={props["aria-describedby"]}
        onClick={() => (open ? close() : openCal())} onKeyDown={onKey}
      >
        <svg className="ui-cal-icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span className={`ui-date-value${value ? "" : " is-placeholder"}`}>{value ? displayDate(value) : placeholder}</span>
      </button>
      {open && createPortal(
        <div ref={panel} className="ui-pop ui-cal" style={pos} role="dialog" aria-label={props["aria-label"] ?? "Choose date"} onKeyDown={onKey} tabIndex={-1}>
          <div className="ui-cal-head">
            <button type="button" className="ui-cal-nav" aria-label="Previous" disabled={view === "days" && !canPrev}
              onClick={() => setCursor(view === "days" ? addMonths(cursor, -1) : view === "months" ? addMonths(cursor, -12) : addMonths(cursor, -144))}>‹</button>
            <button type="button" className="ui-cal-title" onClick={() => setView(view === "days" ? "months" : view === "months" ? "years" : "days")}>
              {view === "days" ? `${MONTHS_LONG[c.m]} ${c.y}` : view === "months" ? String(c.y) : `${yearStart} – ${yearStart + 11}`}
            </button>
            <button type="button" className="ui-cal-nav" aria-label="Next" disabled={view === "days" && !canNext}
              onClick={() => setCursor(view === "days" ? addMonths(cursor, 1) : view === "months" ? addMonths(cursor, 12) : addMonths(cursor, 144))}>›</button>
          </div>
          {view === "days" && (
            <div className="ui-cal-grid" role="grid">
              {WEEK.map((w) => <span key={w} className="ui-cal-dow">{w}</span>)}
              {cells.map((s, i) => s === null ? <span key={`x${i}`} /> : (
                <button
                  key={s} type="button" role="gridcell" disabled={outOfRange(s)} aria-selected={s === value} aria-label={displayDate(s)}
                  className={`ui-day${s === value ? " is-selected" : ""}${s === today ? " is-today" : ""}${s === cursor ? " is-cursor" : ""}${i % 7 === 6 ? " is-sun" : ""}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
                >{Number(s.slice(8))}</button>
              ))}
            </div>
          )}
          {view === "months" && (
            <div className="ui-cal-months">
              {MONTHS.map((m, i) => (
                <button key={m} type="button" disabled={monthOut(c.y, i)} className={`ui-cal-cell${i === c.m ? " is-selected" : ""}`}
                  onClick={() => { setCursor(ymd(c.y, i, Math.min(c.d, daysIn(c.y, i)))); setView("days"); }}>{m}</button>
              ))}
            </div>
          )}
          {view === "years" && (
            <div className="ui-cal-months">
              {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y) => (
                <button key={y} type="button" className={`ui-cal-cell${y === c.y ? " is-selected" : ""}`}
                  disabled={(!!min && YMD.test(min) && `${y}-12-31` < min) || (!!max && YMD.test(max) && `${y}-01-01` > max)}
                  onClick={() => { setCursor(ymd(y, c.m, Math.min(c.d, daysIn(y, c.m)))); setView("months"); }}>{y}</button>
              ))}
            </div>
          )}
          <div className="ui-cal-foot">
            <button type="button" className="ui-cal-link" disabled={!value || required} onClick={() => { onChange?.(fakeEvent("")); close(); }}>Clear</button>
            <button type="button" className="ui-cal-link is-strong" disabled={!today || outOfRange(today)} onClick={() => pick(today)}>Today</button>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
