"use client";

import { useState } from "react";
import { useToast } from "@/context/ToastContext";
import { copyText } from "@/utils/format";

export default function CopyButton({ value, label }: { value: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);

  async function onCopy() {
    const ok = await copyText(value);
    if (ok) {
      setDone(true);
      toast(`${label ?? "Value"} copied: ${value}`);
      setTimeout(() => setDone(false), 1400);
    } else {
      toast("Copy failed. Please copy manually.", "error");
    }
  }

  return (
    <button
      type="button"
      className={`copy-btn${done ? " copied" : ""}`}
      onClick={onCopy}
      aria-label={`Copy ${label ?? "value"} ${value}`}
      title="Copy"
    >
      {done ? "✓" : "⧉"}
    </button>
  );
}
