"use client";

import { useRef, useState } from "react";
import TableWrap from "@/components/ui/TableWrap";
import { Modal } from "@/components/ui/Ui";
import { useToast } from "@/context/ToastContext";
import { downloadFile, postFile } from "@/services/api";

export type ImportKind = "vehicles" | "drivers";
export interface ImportRow { row: number; status: "VALID" | "ERROR"; errors: string[]; label: string }
export interface ImportCheck { kind: ImportKind; total: number; valid: number; invalid: number; rows: ImportRow[] }
export interface ImportDone { kind: ImportKind; total: number; imported: number; failed: number; created: { row: number; id: string; label: string }[]; failedRows: ImportRow[] }

const NOUN: Record<ImportKind, [string, string]> = { vehicles: ["vehicle", "vehicles"], drivers: ["driver", "drivers"] };
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Client-side file check before upload (the server re-checks the real content). */
export function importFileError(f: { name: string; size: number } | null): string | null {
  if (!f) return "Choose an Excel file (.xlsx)";
  if (!/\.xlsx$/i.test(f.name)) return "Only Excel .xlsx files can be imported";
  if (f.size === 0) return "The file is empty";
  if (f.size > MAX_IMPORT_BYTES) return "The file is too large (maximum 10 MB)";
  return null;
}

/**
 * Import from Excel: download the template, choose the filled file, check it (every row validated on the server, nothing saved),
 * then import. The Import button is enabled only when every row is valid; the server enforces the same rule again.
 */
export function BulkImportButton({ kind, onImported }: { kind: ImportKind; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>Import from Excel</button>
      {open && <BulkImportDialog kind={kind} onClose={() => setOpen(false)} onImported={onImported} />}
    </>
  );
}

export function BulkImportDialog({ kind, onClose, onImported }: { kind: ImportKind; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [done, setDone] = useState<ImportDone | null>(null);
  const [busy, setBusy] = useState<"" | "template" | "check" | "import">("");
  const [error, setError] = useState("");
  const [one, many] = NOUN[kind];

  const template = async () => {
    setBusy("template");
    try {
      await downloadFile(`/${kind}/import/template`, `${kind}-import-template.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const choose = async (f: File | null) => {
    setFile(f);
    setCheck(null);
    setDone(null);
    setError("");
    const bad = importFileError(f);
    if (bad) return setError(bad);
    setBusy("check");
    try {
      setCheck((await postFile<ImportCheck>(`/${kind}/import/preview`, f!)).data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const run = async () => {
    if (!file || !check || check.invalid) return;
    setBusy("import");
    setError("");
    try {
      const r = await postFile<ImportDone | ImportCheck>(`/${kind}/import`, file, true);
      if (!r.ok) {
        setCheck(r.data as ImportCheck); // the file changed or became invalid since the check: show the fresh row errors
        setError(r.message);
        return;
      }
      const d = r.data as ImportDone;
      setDone(d);
      toast(`${d.imported} ${d.imported === 1 ? one : many} imported${d.failed ? `, ${d.failed} failed` : ""}`, d.failed ? "error" : undefined);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const errors = check?.rows.filter((r) => r.status === "ERROR") ?? [];
  return (
    <Modal title={`Import ${many} from Excel`} wide onClose={busy ? () => {} : onClose}>
      <ol className="import-steps muted">
        <li>Download the template. It lists every column (required ones marked *) with sample rows and an Instructions sheet.</li>
        <li>Fill one {one} per row and remove the sample rows. Save as .xlsx.</li>
        <li>Choose the file: every row is checked first. Fix any errors and choose the file again.</li>
      </ol>
      <div className="actions-row" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn btn-outline" onClick={template} disabled={!!busy}>{busy === "template" ? "Preparing…" : "Download Template"}</button>
        <button type="button" className="btn btn-outline" onClick={() => input.current?.click()} disabled={!!busy}>{file ? "Choose Another File" : "Choose Excel File"}</button>
        {file && <small className="muted">{file.name}</small>}
        <input ref={input} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={`${many} Excel file`}
          onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; void choose(f); }} />
      </div>
      {busy === "check" && <p className="muted" role="status">Checking rows…</p>}
      {error && <div className="alert" role="alert">{error}</div>}

      {check && !done && (
        <div data-section="import-check">
          <p role="status">
            <strong>{check.total}</strong> row{check.total === 1 ? "" : "s"} · <span className="ok-text">{check.valid} valid</span> · <span className={check.invalid ? "bad-text" : ""}>{check.invalid} with errors</span>
          </p>
          {errors.length > 0 ? (
            <TableWrap>
              <table className="table" data-section="import-errors">
                <thead><tr><th>Row</th><th>{kind === "vehicles" ? "Vehicle No" : "Driver"}</th><th>Errors</th></tr></thead>
                <tbody>
                  {errors.map((r) => (
                    <tr key={r.row} className="rej-row">
                      <td className="num">{r.row}</td>
                      <td>{r.label || "—"}</td>
                      <td><ul className="import-errs">{r.errors.map((m) => <li key={m}>{m}</li>)}</ul></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="muted">Every row is valid and none of them is a duplicate. Nothing is saved until you click Import.</p>
          )}
        </div>
      )}

      {done && (
        <div data-section="import-done" role="status">
          <p><strong>{done.imported}</strong> of {done.total} {many} imported.</p>
          {done.failedRows.length > 0 && (
            <ul className="import-errs">{done.failedRows.map((r) => <li key={r.row}>Row {r.row} ({r.label}): {r.errors.join("; ")}</li>)}</ul>
          )}
        </div>
      )}

      <div className="actions-row">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={!!busy}>{done ? "Close" : "Cancel"}</button>
        {!done && (
          <button type="button" className="btn btn-primary" onClick={run} disabled={!check || check.invalid > 0 || !!busy}
            title={check?.invalid ? "Fix the rows with errors and choose the file again" : ""}>
            {busy === "import" ? "Importing…" : check ? `Import ${check.valid} ${check.valid === 1 ? one : many}` : "Import"}
          </button>
        )}
      </div>
    </Modal>
  );
}
