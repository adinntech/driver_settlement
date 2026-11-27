# Built on the server from the source on main_build. Build context: repository root.
# Order: install -> tests (frontend + backend) -> build -> runtime image.
# A failing test or build fails the image build, so the running container is left as it is.

FROM node:24-bookworm-slim AS backend-deps
WORKDIR /repo/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS frontend-deps
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Throwaway MongoDB that lives only inside this build step; the live database is never reachable from here.
# Both packages are present because each side's tests import a few files of the other.
FROM mongo:8.0 AS tests
COPY --from=backend-deps /usr/local /usr/local
ENV TZ=Asia/Kolkata
WORKDIR /repo
COPY backend ./backend
COPY frontend ./frontend
COPY --from=backend-deps /repo/backend/node_modules ./backend/node_modules
COPY --from=frontend-deps /repo/frontend/node_modules ./frontend/node_modules
RUN mkdir -p /tmp/db \
  && mongod --dbpath /tmp/db --bind_ip 127.0.0.1 --port 27017 --wiredTigerCacheSizeGB 0.25 --fork --logpath /tmp/mongod.log \
  && cd /repo/backend && npm test \
  && cd /repo/frontend && npm test \
  && rm -rf /tmp/db

FROM tests AS backend-build
WORKDIR /repo/backend
RUN npm run build

FROM tests AS frontend-build
ARG NEXT_PUBLIC_ENVIRONMENT
ARG NEXT_PUBLIC_BASE_PATH
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_ENVIRONMENT=$NEXT_PUBLIC_ENVIRONMENT \
  NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH \
  NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
WORKDIR /repo/frontend
RUN npm run build && rm -rf .next/cache

FROM node:24-alpine AS backend
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend-build /repo/backend/dist ./dist
COPY backend/assets ./assets
RUN mkdir -p public .cache && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["node", "dist/server.js"]

FROM node:24-alpine AS frontend
ARG NEXT_PUBLIC_BASE_PATH
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=frontend-build /repo/frontend/.next ./.next
COPY frontend/public ./public
COPY frontend/next.config.ts ./next.config.ts
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
