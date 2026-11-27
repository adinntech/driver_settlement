"use client";

import Select from "@/components/ui/Select";
import { VERTICAL_OPTIONS } from "@/utils/vertical";

/** The Vertical filter of every list: "" (All Verticals, the default), "ROADSHOW" or "SIGNAGE". */
export default function VerticalSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Vertical">
      {VERTICAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
