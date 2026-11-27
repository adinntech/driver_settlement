---
name: deploy-the-build
description: Deploy Driver Settlement by merging origin/main into the main_build branch and pushing it, so Jenkins tests, builds and deploys on the server. Use when the user says deploy, deploy the build, push to main_build, or ship frontend/backend.
---

# deploy-the-build

Repo: GitHub `adinntech/driver_settlement` (work from the current checkout).
Live URL: `https://adinntech.in/driver-settlement`

## How the deployment works
`main_build` holds **source code** (same as `main`, plus any CI commits). Nothing is built locally and no build output is committed.

A push to `main_build` triggers the single Jenkins job `driver-settlement` (`ci/Jenkinsfile`). For each affected service the server runs `deploy/Dockerfile`: **tests (frontend and backend, with a throwaway MongoDB) -> build -> deploy -> health check**. A failing test or build leaves the running container as it is.

Which services deploy depends on the paths changed since the last successful run: `backend/` -> backend, `frontend/` -> frontend, `deploy/`, `docker-compose.prod.yml` or `.dockerignore` -> both. Backend goes first; if it fails, frontend is not deployed. One Google Chat message reports each run.

If `ci/` or `deploy/` on `origin/main_build` no longer match this description, stop and tell the user before pushing.

## Which side
Merging `main` brings all of its changes, and Jenkins picks the services from the changed paths. There is no frontend-only or backend-only deploy: if the user asks for one side and `main` has changes for both, say so and ask.

## Hard rules
- This skill pushes only `main_build`. It never commits to or pushes `main`; if the work to deploy is not on `origin/main`, say so (push `main` only when the user asks).
- Never touch the user's working folder, branch or untracked files. Work in a temporary worktree and remove it at the end.
- Never commit build output, `node_modules`, `.env` files or secrets.
- Never SSH into the server, restart containers or edit Jenkins. Jenkins does the deploy.
- Never `git push --force`.

## Steps

1. **Fetch and show what will ship.**
   ```
   git fetch origin
   git log --oneline origin/main_build..origin/main
   git diff --stat origin/main_build...origin/main | tail -15
   ```
   No commits: say "nothing to deploy" and stop. Otherwise tell the user the commits and services that will deploy.

2. **Check locally** (the server runs the tests again, so this only catches failures early): if not already done in this session for this code, run `npm test` in `backend/` (needs local MongoDB) and `frontend/`. Report failures and ask before pushing.

3. **Merge in a temporary worktree** (a new, not yet existing folder in the scratchpad or system temp directory):
   ```
   git worktree add --detach <tmp>/ds-out origin/main_build
   cd <tmp>/ds-out && git merge --no-ff origin/main -m "Merge branch 'main' into main_build"
   ```
   End the message with the Co-Authored-By line from the session's attribution reminder, if one is present. On a merge conflict, stop and show the conflicting files.

4. **Push** (this triggers the deployment): `git push origin HEAD:refs/heads/main_build`. If rejected as non-fast-forward, fetch, recreate the worktree from the new tip and redo steps 3-4.

5. **Clean up:** `git worktree remove --force <tmp>/ds-out`, then `git worktree prune`.

6. **Report** (in Tanglish if the user writes Tanglish): commits shipped, the `main_build` commit pushed, services expected to deploy, and that the result is **not confirmed** until the `driver-settlement` job at `https://adinntech.in/dev-ops/` is green. Tests and build take several minutes. Afterwards, `https://adinntech.in/driver-settlement/login` and `.../driver-settlement/api/health` should return 200; these alone do not prove the new version is running.

## If the run fails
Point the user to the Jenkins console log (stage Test / Build / Deploy). Rerunning the job is safe. A failed health check after deploy leaves a `driver-settlement-<frontend|backend>:rollback` image on the server; the user decides whether to roll back.
