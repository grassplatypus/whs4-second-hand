# Web (Next.js standalone) image.
# Prisma 7 uses driver adapters (@prisma/adapter-pg) — no Rust query-engine
# binary is needed at runtime, only the generated JS client
# (node_modules/.prisma + node_modules/@prisma/client), which `prisma generate`
# produces at build time. next.config.ts sets output: "standalone" so the
# runtime stage only needs .next/standalone + .next/static + public.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate && pnpm build

FROM base AS run
ENV NODE_ENV=production
# Next standalone server binds to process.env.HOSTNAME; Docker auto-sets HOSTNAME
# to the container id, so the server would bind to the container IP only and
# in-container localhost (healthcheck) gets connection-refused. Pin to 0.0.0.0.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
