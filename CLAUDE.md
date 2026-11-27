# Driver Settlement

Roadshow / Signage operations app for an advertising company. Two independent npm packages (no root package.json).

## Layout
- `backend/`: Express 5, Mongoose, TypeScript ESM (imports end in `.js`). `src/`: `routes/` -> `controllers/` -> `services/` (business logic), plus `validators/`, `models/`, `utils/`, `jobs/`, `seed/`. Port 5000.
- `frontend/`: Next.js 16, React 19. `src/app/<role>/` pages, shared `components/`, `utils/`, `types/domain.ts`, styles in `app/globals.css`. Port 3000.
- Next.js here differs from older versions: see `frontend/AGENTS.md` before writing Next-specific code.
- `QA-Audit/`: old audit evidence. Do not read unless asked.

## Workflow
RSOP tracking request -> RBP budget -> RSOM approval -> RBP vehicle/driver allotment -> RSA clearance -> RBP delivery (On Road) -> daily / final driver payments -> RSOM / RSO approval -> RSA completion.

## Roles (enforced by `requireRole` in `backend/src/routes`; check the route before changing access)
- RSOP: creates and views tracking requests.
- RBP: budgets, vehicles, drivers, allotments, delivery, tolls, payment entry.
- RSOM: budget approval; settlement approval.
- RSA: clearance, vehicle expense payments, payment entry, completion, accounts export.
- RSO: final settlement approval, reports.

## Business rules that are easy to break
- Project Code: 8 digits. One code per project type belongs to one client; later requests under it join that project.
- Trackup Number is **shared** by all vehicles of one type within a project; **PIF Number is unique per vehicle**. Identify a vehicle by PIF or `trackingVehicle` id, never by Trackup. Older records have one Trackup per vehicle and must keep working. There is no display number.
- Vehicle type quantities must equal the vehicle count. The list is duplicated in `backend/src/utils/vehicleTypes.ts` and `frontend/src/utils/vehicleTypes.ts`.
- Business dates are IST `YYYY-MM-DD` strings.
- The server is authoritative: totals, identifiers and names are never taken from the browser. Several validations are mirrored in the frontend; change both.
- No MongoDB transactions (standalone): multi-step writes use guarded updates plus compensation.
- History / event collections are append-only.

## Commands (run inside `backend/` or `frontend/`)
- Check: `npx tsc --noEmit`, `npm run lint`, `npm test`. Single file: `npx tsx --test tests/<name>.test.ts`.
- Backend tests need local MongoDB and take several minutes: run the affected files first, the full suite once at the end.
- Dev data (backend): `npm run seed:dev`, `npm run seed:mock`.
- The user usually has both dev servers running with auto-reload: saving backend code can change the local database (startup migrations, indexes). Do not start second servers on 3000 / 5000.

## Constraints
- Tests that drop a database must use a `driver_settlement_test_*` URI, import app code dynamically, and assert the name first (`tests/testDbSafety.test.ts`).
- Never print `.env` values. Do not commit, push, deploy or add dependencies unless asked.
- Smallest change that does the job: no unrelated refactoring, renaming or reformatting. Follow the style of the surrounding file.
- Checkout uses CRLF; avoid `sed -i` bulk edits that rewrite line endings.

## Working economically
- Search for the symbol first; read only the matching files or line ranges. Do not scan the repository or re-read files already in context.
- Limit command output (`grep`, `tail`); do not dump whole logs or large files.
- No subagents, skills, plugins or MCP tools unless the task needs them or the user asks.
- Replies: lead with the result, a few lines, no repeated summaries. Progress updates: one line.
- Still read the whole code path before changing business logic, and say what was not verified.
