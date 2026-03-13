# ===== Build Stage =====
FROM node:22-slim AS build

RUN npm install -g pnpm@10

WORKDIR /app

# Copy package files
COPY server/package.json server/pnpm-lock.yaml* server/
COPY dashboard/package.json dashboard/pnpm-lock.yaml* dashboard/

# Install dependencies
RUN cd server && pnpm install --frozen-lockfile || pnpm install
RUN cd dashboard && pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY server/ server/
COPY dashboard/ dashboard/

# Build server
RUN cd server && pnpm build

# Build dashboard (outputs to server/dist/dashboard/)
RUN cd dashboard && pnpm build

# ===== Runtime Stage =====
FROM node:22-slim

WORKDIR /app

# Copy built server with dashboard
COPY --from=build /app/server/dist/ dist/
COPY --from=build /app/server/node_modules/ node_modules/
COPY --from=build /app/server/package.json .

ENV PORT=3004
ENV NODE_OPTIONS="--max-old-space-size=1536"
EXPOSE 3004

VOLUME /data
ENV BEEPBOT_DATA_DIR=/data

CMD ["node", "dist/index.js"]
