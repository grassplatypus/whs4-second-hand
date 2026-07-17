# WS (socket.io) image. Runs the TypeScript entry directly via tsx — no
# separate build step needed since this is a small standalone server.
# WS_STANDALONE=1 makes src/server/ws/index.ts start listening on WS_PORT.

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
ENV WS_STANDALONE=1
ENV TSX_DISABLE_CACHE=1
EXPOSE 4000
USER node
CMD ["pnpm", "exec", "tsx", "src/server/ws/index.ts"]
