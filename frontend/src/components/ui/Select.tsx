"use client";

import {
  Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";

/**
 * Drop-in replacement for a native <select>: same props (value, onChange(e) with e.target.value, <option> children, disabled,
 * aria-label…), so callers keep their values, validation and handlers. Renders a styled trigger + popover listbox, searchable
 * for long lists, full keyboard support, and keeps a visually hidden native <select> in sync for forms, autofill and tests.
 */
export interface SelectProps {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  autoFocus?: boolean;
  /** Force (true) or disable (false) the search box. Default: on when there are more than 8 options. */
  searchable?: boolean;
  /** Extra class and minimum width (default 180) of the option popover. */
  popClassName?: string;
  popMinWidth?: number;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

interface Opt { value: string; label: string; disabled: boolean }

const textOf = (n: ReactNode): string => {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return "";
};

function collect(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
    if (el.type === "option") {
      const label = textOf(el.props.children);
      out.push({ value: el.props.value !== undefined ? String(el.props.value) : label, label, disabled: !!el.props.disabled });
    } else if (el.props.children) collect(el.props.children, out); // fragments / optgroups
  });
  return out;
}

const fakeEvent = (value: string) =>
  ({ target: { value }, currentTarget: { value }, preventDefault() {}, stopPropagation() {} }) as unknown as ChangeEvent<HTMLSelectElement>;

/** Fixed-position popover anchored to `anchor`, flipped above when there is no room below, always inside the viewport. */
export function usePopoverPosition(open: boolean, anchorRef: RefObject<HTMLElement | null>, panelRef: RefObject<HTMLElement | null>, minWidth = 0) {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", top: -9999, left: -9999, visibility: "hidden" });
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    const width = Math.min(Math.max(r.width, minWidth), vw - 16);
    const ph = panel.offsetHeight;
    const below = vh - r.bottom - gap - 8;
    const above = r.top - gap - 8;
    const up = ph > below && above > below;
    const top = up ? Math.max(8, r.top - gap - ph) : Math.min(r.bottom + gap, vh - 8 - Math.min(ph, below));
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    setStyle({ position: "fixed", top, left, width, maxHeight: Math.max(160, up ? above : below), visibility: "visible" });
  }, [anchorRef, panelRef, minWidth]);
  useLayoutEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(place); // after the panel has rendered, so its height is known
    const on = () => place();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [open, place]);
  return style;
}

export default function Select(props: SelectProps) {
  const { value: controlled, defaultValue, onChange, children, disabled, required, name, id, className, style, title, autoFocus, searchable } = props;
  const options = useMemo(() => collect(children), [children]);
  const [inner, setInner] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const value = controlled !== undefined ? String(controlled) : inner;
  const selected = options.find((o) => o.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const withSearch = searchable ?? options.length > 8;
  const clearable = !disabled && value !== "" && options.some((o) => o.value === "");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const pos = usePopoverPosition(open, trigger, panel, props.popMinWidth ?? 180);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setQuery("");
    if (focus) trigger.current?.focus();
  }, []);
  const choose = (o: Opt) => {
    if (o.disabled) return;
    if (controlled === undefined) setInner(o.value);
    if (o.value !== value) onChange?.(fakeEvent(o.value));
    close();
  };
  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  };

  useEffect(() => {
    if (!open) return;
    if (withSearch) search.current?.focus();
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open, withSearch, close]);
  useEffect(() => {
    if (open && active >= 0) panel.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const move = (dir: 1 | -1) => {
    if (!visible.length) return;
    let i = active;
    for (let n = 0; n < visible.length; n++) {
      i = (i + dir + visible.length) % visible.length;
      if (!visible[i].disabled) break;
    }
    setActive(i);
  };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openList();
      } else if (e.key.length === 1 && /\S/.test(e.key)) { // type-ahead on the closed control, like a native select
        const now = Date.now();
        typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
        const hit = options.find((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
        if (hit && hit.value !== value) {
          if (controlled === undefined) setInner(hit.value);
          onChange?.(fakeEvent(hit.value));
        }
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(visible.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (visible[active]) choose(visible[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
  };

  const placeholder = options.find((o) => o.value === "")?.label || "Select…";
  return (
    <span className={`ui-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`} style={style} title={title}>
      <select className="ui-native" tabIndex={-1} aria-hidden="true" value={value} name={name} required={required} disabled={disabled} aria-label={props["aria-label"]} onChange={(e) => onChange?.(e)}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      <button
        ref={trigger} type="button" id={id} className="ui-select-trigger" disabled={disabled} autoFocus={autoFocus}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={props["aria-label"]} aria-describedby={props["aria-describedby"]}
        onClick={() => (open ? close() : openList())} onKeyDown={onKey}
      >
        <span className={`ui-select-value${!selected || selected.value === "" ? " is-placeholder" : ""}`}>{selected ? selected.label || placeholder : placeholder}</span>
        <svg className="ui-chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {clearable && (
        <button type="button" className="ui-select-clear" aria-label="Clear selection" tabIndex={-1} onClick={() => { if (controlled === undefined) setInner(""); onChange?.(fakeEvent("")); }}>×</button>
      )}
      {open && createPortal(
        <div ref={panel} className={`ui-pop ui-select-pop${props.popClassName ? ` ${props.popClassName}` : ""}`} style={pos} onKeyDown={onKey}>
          {withSearch && (
            <div className="ui-select-search">
              <input ref={search} value={query} placeholder="Search…" aria-label="Search options" onChange={(e) => { setQuery(e.target.value); setActive(0); }} />
            </div>
          )}
          <ul id={listId} role="listbox" className="ui-select-list" aria-label={props["aria-label"]}>
            {visible.length === 0 && <li className="ui-select-none">No matches</li>}
            {visible.map((o, i) => (
              <li
                key={`${o.value}-${i}`} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                className={`ui-opt${o.value === value ? " is-selected" : ""}${i === active ? " is-active" : ""}${o.disabled ? " is-disabled" : ""}${o.value === "" ? " is-empty" : ""}`}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
              >
                <span>{o.label || placeholder}</span>
                {o.value === value && <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </span>
  );
}
