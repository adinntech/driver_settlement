"use client";

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

/**
 * Scroll container for every data table. Wide tables scroll sideways inside it (styled scrollbar) and get left / right arrow
 * buttons that appear only when there is more to see in that direction. Tall tables scroll inside it too, so the header row
 * stays sticky. Replaces the plain <div className="table-wrap"> everywhere; extra props (aria-busy, data-*) are passed through.
 */
export default function TableWrap({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right })); // no re-render when nothing changed
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(update);
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild); // the table itself grows when rows / columns change
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className={`tw${edge.left ? " can-left" : ""}${edge.right ? " can-right" : ""}`}>
      <button type="button" className="tw-arrow tw-left" aria-label="Scroll table left" tabIndex={edge.left ? 0 : -1} aria-hidden={!edge.left} onClick={() => scroll(-1)}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div ref={ref} className={`table-wrap${className ? ` ${className}` : ""}`} {...rest}>
        {children}
      </div>
      <button type="button" className="tw-arrow tw-right" aria-label="Scroll table right" tabIndex={edge.right ? 0 : -1} aria-hidden={!edge.right} onClick={() => scroll(1)}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}
