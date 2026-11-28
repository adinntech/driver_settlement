"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** True when the clamped box hides part of its text (1px tolerance for sub-pixel line heights). */
export const isClipped = (el: { scrollHeight: number; clientHeight: number }) => el.scrollHeight - el.clientHeight > 1;

/** Long remarks / reasons: two lines by default, with Read more / Read less only when the text does not fit. */
export default function ReadMore({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  // Measured while collapsed, and again whenever the width or the text changes.
  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const observer = new ResizeObserver(() => setClipped(isClipped(el)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, children]);

  return (
    <span className="read-more">
      <span ref={ref} className={`read-more-text${open ? "" : " clamped"}`}>{children}</span>
      {(clipped || open) && (
        <button type="button" className="read-more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Read less" : "Read more"}
        </button>
      )}
    </span>
  );
}
