#!/bin/sh
set -e

# Build dashboard on first run if dist/ is missing (the host volume
# mount overwrites the image's pre-built copy, so a fresh clone
# won't have it).
if [ ! -f dashboard/dist/index.html ]; then
  echo "[long-tail] Dashboard not built — running npm install + build..."
  cd dashboard && npm install && npm run build && cd ..
fi

exec "$@"
