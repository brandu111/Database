# BrandU trade mark database — production image.
# Multi-stage: build the deploy bundle, then ship a lean runtime that installs
# only better-sqlite3 (the single native dependency).

# ---- build stage -----------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build:deploy

# ---- runtime stage ---------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The deploy bundle has no runtime dependencies (Node's built-in SQLite is used),
# so there is nothing to install — just copy it in.
COPY --from=build /app/deploy/ ./
# Persist the database and uploaded files on a mounted volume.
VOLUME ["/app/data", "/app/uploads"]
EXPOSE 3000
# Seed once on an empty database, then serve. Re-seeding is a no-op guarded in
# code, so this is safe on every restart.
ENV SEED_ON_START=1
CMD ["node", "app.cjs"]
