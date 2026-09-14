# syntax=docker/dockerfile:1.7
#
# One image, two processes: the Next server and the scheduler. They share every
# line of business logic — the sweeper calls the same services the API does — so
# building them twice would let the two drift and double the surface to patch.
# docker-compose.prod.yml runs this image with two different commands.

# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies. Cached on the lockfile alone, so a source change does not
# re-resolve the tree.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# Production-only dependencies, for the runtime image.
#
# A separate install rather than a subset copied out of the dev tree: pnpm
# links every package through node_modules/.pnpm, so copying `node_modules/.x`
# alone yields a dangling symlink and the build fails at COPY — or worse, does
# not, and the container dies on its first import.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
# --ignore-scripts skips husky's `prepare`, which installs git hooks and has no
# place in a container. Prisma's client is generated explicitly below instead.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm exec prisma generate

# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The client bundle is compiled here, so anything NEXT_PUBLIC_ has to exist at
# build time. Everything secret is read at runtime instead.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_TELEMETRY_DISABLED=1
# Produces .next/standalone. Opt-in, because `next start` cannot serve it and
# local development and the e2e suite both use `next start`.
ENV NEXT_OUTPUT=standalone

RUN pnpm exec prisma generate && pnpm build

# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Every timestamp is stored UTC and rendered IST by the application (SDD 4.6).
# Pinning the container clock to UTC removes one way for those to disagree.
ENV TZ=UTC

# Next's standalone server binds to `process.env.HOSTNAME || '0.0.0.0'`, and
# Docker sets HOSTNAME to the container id — so without this it listens on that
# one interface, the HEALTHCHECK on 127.0.0.1 is refused, and the container is
# marked unhealthy while serving traffic perfectly well through the network.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Never root: a compromise inside the app should not be able to rewrite the
# image it runs from.
RUN addgroup -g 1001 -S jtas && adduser -u 1001 -S jtas -G jtas

COPY --from=build --chown=jtas:jtas /app/.next/standalone ./
COPY --from=build --chown=jtas:jtas /app/.next/static ./.next/static
COPY --from=build --chown=jtas:jtas /app/public ./public

# The worker and the migration step are not in the Next bundle — the worker
# runs TypeScript directly and `prisma migrate deploy` is a CLI — so they get
# the production dependency tree whole. Copied after the standalone output so
# it wins where the two overlap.
COPY --from=prod-deps --chown=jtas:jtas /app/node_modules ./node_modules
COPY --from=build --chown=jtas:jtas /app/worker ./worker
COPY --from=build --chown=jtas:jtas /app/src ./src
COPY --from=build --chown=jtas:jtas /app/scripts ./scripts
COPY --from=build --chown=jtas:jtas /app/prisma ./prisma
COPY --chown=jtas:jtas tsconfig.json tsconfig.worker.json package.json ./

USER jtas
EXPOSE 3000

# The app's own health endpoint, so an unhealthy container is restarted rather
# than left serving errors. It answers 503 on a stale scheduler heartbeat.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
