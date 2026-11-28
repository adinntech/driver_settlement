"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Select, { usePopoverPosition } from "./Select";

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
  /** Extra days that cannot be picked inside min / max. */
  isDayBlocked?: (ymd: string) => boolean;
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
  /** Date + time mode (used by DateTimePicker): "HH:mm" or "". The calendar stays open and reports both values together. */
  time?: string;
  onDateTime?: (date: string, time: string) => void;
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
const Chevron = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "HH:mm" (24 hour) <-> the 12 hour parts shown in the picker. */
export const to12 = (t?: string) => {
  if (!t || !HM.test(t)) return null;
  const h = Number(t.slice(0, 2));
  return { h: h % 12 || 12, m: Number(t.slice(3)), ap: h < 12 ? "AM" : "PM" };
};
export const to24 = (h: number, m: number, ap: string) => `${pad((h % 12) + (ap === "PM" ? 12 : 0))}:${pad(m)}`;
/** "28-Nov-2026, 10:27 AM"; a missing half is shown as such. "" when both are empty. */
export const displayDateTime = (date?: string, time?: string) => {
  const t = to12(time);
  if (!parse(date) && !t) return "";
  return `${displayDate(date) || "dd-mmm-yyyy"}, ${t ? `${pad(t.h)}:${pad(t.m)} ${t.ap}` : "--:-- --"}`;
};
const fakeEvent = (value: string) =>
  ({ target: { value }, currentTarget: { value }, preventDefault() {}, stopPropagation() {} }) as unknown as ChangeEvent<HTMLInputElement>;

export default function DateInput(props: DateInputProps) {
  const { value = "", onChange, min, max, isDayBlocked, disabled, readOnly, required, name, id, className, style, title, autoFocus, time = "", onDateTime } = props;
  const withTime = !!onDateTime;
  const placeholder = props.placeholder ?? (withTime ? "dd-mmm-yyyy, --:-- --" : "dd-mmm-yyyy");
  const shown = withTime ? displayDateTime(value, time) : value ? displayDate(value) : "";
  const t12 = to12(time);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [today, setToday] = useState("");
  const [cursor, setCursor] = useState(""); // keyboard-focused day
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, trigger, panel, onDateTime ? 400 : 280); // the panel width set in CSS

  // A value outside min / max is never changed here (it may be a legitimately saved historical date); forms clear or
  // re-validate dependent dates themselves. It is only flagged so the user can see it needs attention.
  const outOfRange = useCallback((s: string) => (!!min && YMD.test(min) && s < min) || (!!max && YMD.test(max) && s > max), [min, max]);
  const notAllowed = (s: string) => outOfRange(s) || !!isDayBlocked?.(s);
  const invalid = !!value && YMD.test(value) && notAllowed(value);
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
    if (notAllowed(s)) return;
    if (onDateTime) { // stay open so the time can be chosen too
      setCursor(s);
      if (s !== value) onDateTime(s, time);
      return;
    }
    if (s !== value) onChange?.(fakeEvent(s));
    close();
  };
  const clear = () => {
    if (onDateTime) onDateTime("", "");
    else onChange?.(fakeEvent(""));
  };
  // the first part chosen completes the time as 12:00 AM defaults; every part stays editable
  const setPart = (part: { h?: number; m?: number; ap?: string }) => {
    const next = { h: 12, m: 0, ap: "AM", ...t12, ...part };
    onDateTime?.(value, to24(next.h, next.m, next.ap));
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if ((t as Element).closest?.(".ui-time-pop")) return; // the picker's own hour / minute / AM-PM lists
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open, close]);

  const onKey = (e: KeyboardEvent) => {
    if (disabled || readOnly) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown"].includes(e.key)) { e.preventDefault(); openCal(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && (value || time) && !required) { e.preventDefault(); clear(); }
      return;
    }
    if (withTime) {
      const el = e.target as HTMLElement;
      if (el !== trigger.current && !panel.current?.contains(el)) return; // keys of an open time list
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      // Tab moves from the field into the picker (it is rendered at the end of the page)
      if (e.key === "Tab" && el === trigger.current && !e.shiftKey) { e.preventDefault(); panel.current?.querySelector<HTMLElement>(".ui-cal-time .ui-select-trigger")?.focus(); return; }
      if (e.key === "Tab" || el.closest(".ui-cal-time, .ui-cal-foot, .ui-cal-head")) return; // native behaviour there
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
  while (cells.length % 7 || (withTime && cells.length < 42)) cells.push(null); // date + time: six rows, so the height never jumps
  const monthOut = (y: number, m: number) => (!!min && YMD.test(min) && ymd(y, m, daysIn(y, m)) < min) || (!!max && YMD.test(max) && ymd(y, m, 1) > max);
  const yearStart = c.y - (c.y % 12);
  const canPrev = !min || !YMD.test(min) || ymd(c.y, c.m, 1) > min;
  const canNext = !max || !YMD.test(max) || ymd(c.y, c.m, daysIn(c.y, c.m)) < max;

  return (
    <span className={`ui-date${withTime ? " ui-datetime" : ""}${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${readOnly ? " is-readonly" : ""}${invalid ? " is-invalid" : ""}${className ? ` ${className}` : ""}`} style={style} title={invalid ? `${title ? `${title} · ` : ""}Outside the allowed dates` : title}>
      <input className="ui-native" type="date" tabIndex={-1} aria-hidden="true" value={value} min={min} max={max} name={name} required={required} disabled={disabled} readOnly
        aria-label={props["aria-label"]} />
      <button
        ref={trigger} type="button" id={id} className="ui-date-trigger" disabled={disabled} autoFocus={autoFocus} aria-haspopup="dialog" aria-expanded={open}
        aria-label={props["aria-label"] ? `${props["aria-label"]}${shown ? `: ${shown}` : ""}` : undefined} aria-describedby={props["aria-describedby"]}
        onClick={() => (open ? close() : openCal())} onKeyDown={onKey}
      >
        {withTime ? (
          <svg className="ui-cal-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10.5V7a2.5 2.5 0 0 0-2.5-2.5h-12A2.5 2.5 0 0 0 3 7v11.5A2.5 2.5 0 0 0 5.5 21H10M3 9.5h17M8 2.5v4M15 2.5v4" /><circle cx="17" cy="17" r="5" /><path d="M17 14.8V17l1.5 1.2" /></svg>
        ) : <svg className="ui-cal-icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>}
        <span className={`ui-date-value${shown ? "" : " is-placeholder"}`}>{shown || placeholder}</span>
      </button>
      {open && createPortal(
        <div ref={panel} className={`ui-pop ui-cal${withTime ? " has-time" : ""}`} style={pos} role="dialog" aria-label={props["aria-label"] ?? "Choose date"} onKeyDown={onKey} tabIndex={-1}>
          <div className="ui-cal-head">
            <button type="button" className="ui-cal-nav" aria-label="Previous" disabled={view === "days" && !canPrev}
              onClick={() => setCursor(view === "days" ? addMonths(cursor, -1) : view === "months" ? addMonths(cursor, -12) : addMonths(cursor, -144))}>{withTime ? <Chevron d="M15 6l-6 6 6 6" /> : "‹"}</button>
            <button type="button" className="ui-cal-title" onClick={() => setView(view === "days" ? "months" : view === "months" ? "years" : "days")}>
              {view === "days" ? `${MONTHS_LONG[c.m]} ${c.y}` : view === "months" ? String(c.y) : `${yearStart} – ${yearStart + 11}`}
            </button>
            <button type="button" className="ui-cal-nav" aria-label="Next" disabled={view === "days" && !canNext}
              onClick={() => setCursor(view === "days" ? addMonths(cursor, 1) : view === "months" ? addMonths(cursor, 12) : addMonths(cursor, 144))}>{withTime ? <Chevron d="M9 6l6 6-6 6" /> : "›"}</button>
          </div>
          {view === "days" && (
            <div className="ui-cal-grid" role="grid">
              {WEEK.map((w) => <span key={w} className="ui-cal-dow">{w}</span>)}
              {cells.map((s, i) => s === null ? (
                <span key={`x${i}`} className={withTime ? "ui-day-out" : undefined} aria-hidden>{withTime ? new Date(Date.UTC(c.y, c.m, i - first + 1)).getUTCDate() : null}</span>
              ) : (
                <button
                  key={s} type="button" role="gridcell" disabled={notAllowed(s)} aria-selected={s === value} aria-label={displayDate(s)}
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
          {/* Escape that closed a time list must not also close the surrounding dialog */}
          {withTime && (
            <div className="ui-cal-time" role="group" aria-label="Time (IST)" onKeyDown={(e) => { if (e.key === "Escape" && e.defaultPrevented) e.stopPropagation(); }}>
              <div className="ui-cal-time-head">
                <span>Time (IST)</span>
                <strong>{t12 ? `${pad(t12.h)}:${pad(t12.m)} ${t12.ap}` : "--:-- --"}</strong>
              </div>
              <div className="ui-cal-time-row">
                <div className="ui-cal-time-field"><span>Hour</span>
                  <Select aria-label="Hour" popMinWidth={0} popClassName="ui-time-pop ui-time-hours" searchable={false} value={t12?.h ?? ""} onChange={(e) => setPart({ h: Number(e.target.value) })}>
                    {!t12 && <option value="">--</option>}
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                  </Select>
                </div>
                <div className="ui-cal-time-field"><span>Minute</span>
                  <Select aria-label="Minute" popMinWidth={0} popClassName="ui-time-pop" value={t12?.m ?? ""} onChange={(e) => setPart({ m: Number(e.target.value) })}>
                    {!t12 && <option value="">--</option>}
                    {Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{pad(m)}</option>)}
                  </Select>
                </div>
                <div className="ui-cal-time-field"><span>AM / PM</span>
                  <Select aria-label="AM or PM" popMinWidth={0} popClassName="ui-time-pop" searchable={false} value={t12?.ap ?? ""} onChange={(e) => setPart({ ap: e.target.value })}>
                    {!t12 && <option value="">--</option>}
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <div className="ui-cal-foot">
            <button type="button" className="ui-cal-link" disabled={(!value && !time) || required} onClick={() => { clear(); close(); }}>Clear</button>
            <button type="button" className="ui-cal-link is-strong" disabled={!today || notAllowed(today)} onClick={() => pick(today)}>Today</button>
            {withTime && <button type="button" className="ui-cal-link is-strong" onClick={() => close()}>Done</button>}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
