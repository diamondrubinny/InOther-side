# syntax=docker/dockerfile:1.7
# Web (Next.js) image. Build from the repository root:
#   docker build -f infra/docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t inother-web .
# NEXT_PUBLIC_* values are inlined at BUILD time (they are public by definition; never put secrets there).
# Behind a TLS-inspecting proxy: --secret id=extra_ca,src=/path/to/ca.crt (never baked into a layer).

ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
ENV WITH_CA='if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi;'

FROM base AS build
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    sh -c "$WITH_CA pnpm install --frozen-lockfile --filter @inother/web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @inother/shared build && NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" pnpm --filter @inother/web exec next build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    sh -c "$WITH_CA pnpm install --frozen-lockfile --prod --filter @inother/web..." \
 && rm -rf /root/.cache /root/.local/share/pnpm
ENV WITH_CA=
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/web/.next apps/web/.next
COPY apps/web/public apps/web/public
COPY apps/web/next.config.mjs apps/web/
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/he').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000"]
