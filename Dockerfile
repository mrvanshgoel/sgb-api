# ─── SGB API — multi-stage build ─────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# The lockfile is authored by npm 11 (developers' default). node:22-alpine
# ships npm 10, which resolves peer deps differently and rejects the lockfile
# (EUSAGE: Missing @emnapi/*). Pin npm 11 so the build matches the lockfile.
RUN npm i -g npm@11

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# npm run build compiles TS and copies the static dataset into dist/data
RUN npm run build

# ─── Runtime ─────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN npm i -g npm@11

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as non-root
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/app.js"]
