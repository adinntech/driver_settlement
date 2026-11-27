---
name: deploy-the-build
description: Build the Driver Settlement frontend (Next.js) and/or backend (Node/TypeScript) from the latest origin/main with the live-URL settings, copy only the build output into the main_build branch (frontend-build/, backend-build/), commit and push main_build so Jenkins deploys it automatically. Use when the user says deploy, deploy the build, build and push, or ship frontend/backend.
---

# deploy-the-build

Repo: `G:\sk\git-files\driver_settlement` (GitHub `adinntech/driver_settlement`).
Live URL: `https://adinntech.in/driver-settlement` (server 168.144.123.41).

## How the deployment works
`main` holds source code. `main_build` holds ONLY build output and Docker files. A push to `main_build` triggers the Jenkins jobs `driver settlement frontend` / `driver settlement backend` through the GitHub webhook. Each job deploys its own container only when `frontend-build/` or `backend-build/` changed.

`main_build` layout (never put source code here):
- `frontend-build/`: `.next`, `public`, `package.json`, `package-lock.json`, `next.config.ts`, `README.txt`
- `backend-build/`: `dist`, `assets`, `package.json`, `package-lock.json`
- `deploy/*.Dockerfile`, `docker-compose.prod.yml`, `ci/`, `.env.example`

## Arguments
`frontend`, `backend` or `both` (default `both`). If the user names only one side, build only that side.

## Hard rules
- NEVER push to `main`. Only push `main_build`.
- NEVER touch the user's working folder, branch or untracked files (`backend/.env`, `backend/public`, etc.). Work only in temporary git worktrees under the system temp directory and remove them at the end.
- NEVER commit source code, `node_modules`, `.env` files or secrets to `main_build`.
- NEVER SSH into the server, restart containers, or edit Jenkins from this skill. Jenkins does the deploy.
- Do not use `git push --force`.
- On Git Bash (Windows) prefix commands that carry `/driver-settlement` with `MSYS_NO_PATHCONV=1`, otherwise the path becomes `C:/Program Files/Git/...`.

## Steps

1. **Fetch and pick sources.**
   ```
   cd /g/sk/git-files/driver_settlement && git fetch origin
   MAIN_SHA=$(git rev-parse --short origin/main)
   ```
   Create two worktrees: `git worktree add --detach /tmp/ds-src origin/main` and `git worktree add --detach /tmp/ds-out origin/main_build`.
   Tell the user which `origin/main` commit is being built.

2. **Check the live-URL support exists in main** (frontend only):
   `grep -q basePath /tmp/ds-src/frontend/next.config.ts`. If missing, STOP, remove worktrees, and tell the user: the basePath code changes (`next.config.ts`, `AuthContext.tsx`, `login/page.tsx`, `AppShell.tsx`, `utils/config.ts`) must be committed to `main` first. Backend can still be built.

3. **Build backend** (if requested):
   ```
   cd /tmp/ds-src/backend && npm ci && npm run build
   ```
   Must produce `dist/server.js`. On any error STOP and show the error.

4. **Build frontend** (if requested):
   ```
   cd /tmp/ds-src/frontend && npm ci
   MSYS_NO_PATHCONV=1 NEXT_PUBLIC_BASE_PATH=/driver-settlement NEXT_PUBLIC_API_BASE_URL=https://adinntech.in/driver-settlement/api npx next build
   ```
   Must finish without error and create `.next/BUILD_ID`.

5. **Replace build output in `/tmp/ds-out`** (the `main_build` worktree). Delete the old contents of the folder being replaced first, so removed files do not linger. Keep `frontend-build/README.txt`.
   - Backend: `rm -rf backend-build/dist backend-build/assets`, then copy `dist`, `assets`, `package.json`, `package-lock.json` from `/tmp/ds-src/backend` into `backend-build/`.
   - Frontend: `rm -rf frontend-build/.next frontend-build/public`, then copy `.next` (exclude `cache`, `trace-build`, `diagnostics`), `public`, `package.json`, `package-lock.json`, `next.config.ts` into `frontend-build/`. Example: `(cd /tmp/ds-src/frontend/.next && tar cf - --exclude=./cache --exclude=./trace-build --exclude=./diagnostics .) | (cd /tmp/ds-out/frontend-build/.next && tar xf -)`.

6. **Commit.** From `/tmp/ds-out`: `git add -A -f frontend-build backend-build` (`-f` is required because `.next` and `dist` may be ignored). If `git diff --cached --quiet` shows nothing changed, say "no build changes, nothing to deploy" and clean up.
   Otherwise show `git diff --cached --stat | tail -5`, then commit on the detached HEAD:
   ```
   git -c core.autocrlf=false commit -m "Build: <frontend|backend|both> from main@$MAIN_SHA"
   ```
   End the message with the Co-Authored-By line given in the session's attribution reminder, if one is present.

7. **Push** (this is what triggers deployment):
   `git push origin HEAD:refs/heads/main_build`. If rejected as non-fast-forward, run `git fetch`, re-create the `main_build` worktree from the new tip and redo steps 5-7. Never force.

8. **Clean up** worktrees: `git worktree remove --force /tmp/ds-src` and `/tmp/ds-out` (from the repo folder), then `git worktree prune`.

9. **Report to the user** (reply in Tanglish if the user writes Tanglish): main commit built, sides built, `main_build` commit pushed, and the Jenkins jobs to watch at `https://adinntech.in/dev-ops/`. After about 1-2 minutes optionally verify (read-only):
   `curl -s -o /dev/null -w "%{http_code}" https://adinntech.in/driver-settlement/login` and `.../driver-settlement/api/health` should both return 200. If a check fails, say so with the status code and point to the Jenkins console log; rollback images are `driver-settlement-<frontend|backend>:rollback` on the server (the user decides whether to roll back).

## Notes
- Jenkins deploy scripts live on the server in `/opt/deploy/deploy-driver-settlement.sh`; the server `.env` is separate and untouched by this flow.
- Existing server containers, crons and DB backups are never touched by this skill.
