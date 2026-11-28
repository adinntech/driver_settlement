"use client";

import { useErrorState } from "@/context/ToastContext";
import Select from "@/components/ui/Select";
import DateInput from "@/components/ui/DateInput";
import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Ui";
import { uploadAttachment } from "@/services/api";
import type { Attachment } from "@/types/domain";
import { DOC_KEYS, DOC_LABEL, type DocKey } from "@/utils/vehicleForm";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

/** Client-side file check (the server re-validates type, content and size). */
export function fileError(f: { name: string; size: number }): string | null {
  const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return `Only ${ALLOWED_EXT.join(", ")} files are allowed`;
  if (f.size === 0) return "The selected file is empty";
  if (f.size > MAX_FILE_BYTES) return "File is too large (maximum 10 MB)";
  return null;
}

interface Props {
  initialType: DocKey;
  initial?: { nextRenewalDate: string; attachment: Attachment | null };
  onSave: (type: DocKey, row: { nextRenewalDate: string; attachment: Attachment | null }) => void;
  onClose: () => void;
}

/** "Vehicle Detail" popup opened by the + button: Renewal Type, Next Renewal Date, Attachments. */
export default function RenewalModal({ initialType, initial, onSave, onClose }: Props) {
  const [type, setType] = useState<DocKey>(initialType);
  const [date, setDate] = useState(initial?.nextRenewalDate ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saved] = useState<Attachment | null>(initial?.attachment ?? null);
  const [, setError] = useErrorState<string>("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inflight = useRef(false);

  function pick(f: File | null) {
    if (!f) return;
    const err = fileError(f);
    setError(err ?? "");
    setFile(err ? null : f);
  }

  async function save() {
    if (!date) return setError("Next renewal date is required");
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      const attachment = file ? await uploadAttachment(file) : saved; // upload only when a new file was chosen
      onSave(type, { nextRenewalDate: date, attachment });
    } catch (e) {
      setError((e as Error).message);
      inflight.current = false;
      setBusy(false);
    }
  }

  const shown = file?.name ?? saved?.name ?? "";
  return (
    <Modal title="Vehicle Detail" onClose={busy ? () => {} : onClose}>
      <div className="rm-form">
        <label htmlFor="rn-type">Renewal Type</label>
        <Select id="rn-type" value={type} onChange={(e) => setType(e.target.value as DocKey)} disabled={busy}>
          {DOC_KEYS.map((k) => (
            <option key={k} value={k}>{DOC_LABEL[k]}</option>
          ))}
        </Select>

        <label htmlFor="rn-date">Next Renewal Date</label>
        <DateInput id="rn-date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />

        <label htmlFor="rn-file">Attachments</label>
        <div className="rm-file">
          <input id="rn-file" readOnly value={shown} placeholder="PDF / image, max 10 MB" aria-label="Selected attachment" />
          <button type="button" className="btn btn-outline" onClick={() => input.current?.click()} disabled={busy} aria-label="Browse for a file">....</button>
          <input ref={input} type="file" hidden accept={ALLOWED_EXT.join(",")} onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        </div>
      </div>
      <div className="actions-row">
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Modal>
  );
}
