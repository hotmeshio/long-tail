FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

FROM base AS development
ENV NODE_ENV=development
# ts-node-dev watches for changes and restarts automatically
CMD ["npx", "ts-node-dev", "--respawn", "--poll", "index.ts"]

FROM base AS builder
ENV NODE_ENV=production
RUN npm run build

FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/build ./build
CMD ["node", "build/index.js"]
