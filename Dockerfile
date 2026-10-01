# GardenProof: one image, two processes.
#   web:     docker run … gardenproof                 (next start; set WORKER=off when a worker service runs)
#   worker:  docker run … gardenproof pnpm worker     (content generation, video renders, publishing, sweeps)
#   release: docker run … gardenproof pnpm db:migrate (before rolling out; app/worker use MIGRATE_ON_START=off)
# See docs/DEPLOY.md.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ---- dependencies (cached while the lockfile is unchanged) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .
RUN pnpm build

# ---- runtime ----
FROM base AS runtime
# Shared libraries for Remotion's headless Chromium (video renders). No ffmpeg needed: Remotion ships its own
# compositor. fonts-liberation gives Chromium a fallback font; the video fonts themselves are bundled in video/fonts.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation \
      libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
      libx11-6 libx11-xcb1 libxcb1 libxext6 libxshmfence1 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The whole built app, including dev tooling the worker and release step need (tsx for scripts/*.ts).
COPY --from=build /app ./

# Download Remotion's headless Chromium into the image once, so renders never download at runtime.
# (Alternatively point REMOTION_BROWSER_EXECUTABLE at a Chromium you provide.)
RUN pnpm exec remotion browser ensure
# Writable only where the app writes at runtime: .next/cache, and .data (local PGlite / disk storage, if used).
RUN mkdir -p /app/.data && chown -R node:node /app/.data /app/.next

USER node
EXPOSE 3000
CMD ["pnpm", "start"]
