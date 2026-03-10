FROM node:20-slim AS base
WORKDIR /app

# System deps for Playwright Chromium + general build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 libx11-xcb1 libxcb1 \
    libxfixes3 libxkbcommon0 \
    fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
# Install Playwright Chromium browser binary
RUN npx playwright install chromium
COPY . .

FROM base AS development
ENV NODE_ENV=development
# Build dashboard for dev serving
RUN cd dashboard && npm ci && npm run build
# ts-node-dev watches for changes and restarts automatically
CMD ["npx", "ts-node-dev", "--respawn", "--poll", "index.ts"]

FROM base AS builder
ENV NODE_ENV=production
RUN npm run build
# Build dashboard
RUN cd dashboard && npm ci && npm run build

FROM node:20-slim AS production
ENV NODE_ENV=production
WORKDIR /app

# Same system deps for Playwright in production
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 libx11-xcb1 libxcb1 \
    libxfixes3 libxkbcommon0 \
    fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
RUN npx playwright install chromium
COPY --from=builder /app/build ./build
COPY --from=builder /app/dashboard/dist ./dashboard/dist
CMD ["node", "build/index.js"]
