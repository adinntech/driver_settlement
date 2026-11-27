# Runs a PREBUILT backend (backend-build/ is the build context: dist/, assets/, package files).
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dist ./dist
COPY assets ./assets
RUN mkdir -p public .cache && chown -R node:node /app
USER node
EXPOSE 5000
CMD ["node", "dist/server.js"]
