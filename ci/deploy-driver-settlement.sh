#!/usr/bin/env bash
# Install on the server as /opt/deploy/deploy-driver-settlement.sh. Usage: <script> frontend|backend
# Targeted deploy only: --no-deps, never `down`; never touches mongodb, other containers, crons or backups.
set -Eeuo pipefail
SVC="${1:-}"
[[ "$SVC" == frontend || "$SVC" == backend ]] || { echo "usage: $0 frontend|backend"; exit 2; }
DIR=/opt/driver-settlement
BRANCH="${DS_BRANCH:-main_build}"  # frontend deploys prebuilt frontend-build/ from main_build
case $SVC in
  frontend) PORT=3016; URL=http://127.0.0.1:3016/driver-settlement/login ;;
  backend)  PORT=3017; URL=http://127.0.0.1:3017/api/health ;;
esac
export COMPOSE_IGNORE_ORPHANS=1
exec 9>"/var/lock/deploy-driver-settlement-$SVC.lock"
flock -n 9 || { echo "deploy already running"; exit 1; }
cd "$DIR"
[[ -f .env ]] || { echo ".env missing"; exit 1; }
docker inspect -f '{{.State.Running}}' mongodb | grep -q true || { echo "mongodb not running"; exit 1; }
PREV=$(docker image inspect -f '{{.Id}}' "driver-settlement-$SVC:latest" 2>/dev/null || true)
[[ -n "$PREV" ]] && docker tag "$PREV" "driver-settlement-$SVC:rollback"
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"
docker compose -f docker-compose.prod.yml config -q
docker compose -f docker-compose.prod.yml up -d --build --no-deps "$SVC"
for i in $(seq 1 24); do
  if curl -fsS -o /dev/null "$URL"; then echo "healthy: $SVC on 127.0.0.1:$PORT"; exit 0; fi
  sleep 5
done
echo "HEALTH CHECK FAILED"
docker logs --tail 80 "driver-settlement-$SVC" || true
echo "Rollback: docker tag driver-settlement-$SVC:rollback driver-settlement-$SVC:latest && docker compose -f $DIR/docker-compose.prod.yml up -d --no-deps --no-build $SVC"
exit 1
