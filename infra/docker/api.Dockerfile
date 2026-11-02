# syntax=docker/dockerfile:1.7
# API + worker image (same image, different command). Build from the repository root:
#   docker build -f infra/docker/api.Dockerfile -t inother-api .
# Run:     API     → node dist/server.js        (default)
#          worker  → node dist/worker.js
#          migrate → node dist/db/migrate.js    (with DATABASE_MIGRATION_URL = schema owner)
# No secrets are baked in: all configuration comes from the environment at runtime.
# Behind a TLS-inspecting corporate proxy, pass its CA as a BUILD SECRET (never baked into a layer):
#   docker build --secret id=extra_ca,src=/path/to/ca.crt --build-arg HTTPS_PROXY=... ...

ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# Uses the optional build secret "extra_ca" (see above) for all network steps.
ENV WITH_CA='if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi;'

FROM base AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    sh -c "$WITH_CA pnpm install --frozen-lockfile --filter @inother/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @inother/shared build && pnpm --filter @inother/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    sh -c "$WITH_CA pnpm install --frozen-lockfile --prod --filter @inother/api..." \
 && rm -rf /root/.cache /root/.local/share/pnpm
ENV WITH_CA=
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
# Unprivileged user; the filesystem can be mounted read-only (media goes to S3 in production).
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
