#!/bin/sh
set -e

# Install dashboard deps when node_modules is missing (anonymous volume was
# cleared by `docker compose down -v`, or first run on a fresh clone).
if [ ! -d dashboard/node_modules/.bin ]; then
  echo "[long-tail] Dashboard node_modules missing — running npm install..."
  cd dashboard && npm install && cd ..
fi

# Build dashboard if dist/ is missing.
if [ ! -f dashboard/dist/index.html ]; then
  echo "[long-tail] Dashboard not built — running build..."
  cd dashboard && npm run build && cd ..
fi

exec "$@"
