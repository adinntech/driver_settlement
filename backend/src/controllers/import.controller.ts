import type { NextFunction, Request, Response } from "express";
import { importTemplate, previewImport, runImport, type ImportKind } from "../services/bulkImport.service.js";
import { sendResponse } from "../utils/sendResponse.js";

/** Excel bulk import (Vehicle / Driver Management, RBP). Template download, row-wise validation preview, and the import itself. */
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export const importHandlers = (kind: ImportKind) => ({
  template: wrap(async (_req, res) => {
    const t = await importTemplate(kind);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${t.name}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(t.buffer);
  }),
  preview: wrap(async (req, res) => {
    const r = await previewImport(kind, req.file);
    res.status(200).json(sendResponse(true, r.invalid ? `${r.invalid} of ${r.total} rows have errors` : `All ${r.total} rows are valid`, r));
  }),
  run: wrap(async (req, res) => {
    const r = await runImport(kind, req.file, req.user!.username);
    if (r.blocked) return void res.status(400).json(sendResponse(false, r.message, r.check)); // row-wise errors, nothing saved
    res.status(r.failed ? 207 : 201).json(sendResponse(true, `${r.imported} of ${r.total} ${kind} imported${r.failed ? `; ${r.failed} failed` : ""}`, r));
  }),
});
