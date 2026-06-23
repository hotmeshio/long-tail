import { readFileSync } from 'fs';
import { resolve } from 'path';

import hotmeshPkg from '@hotmeshio/hotmesh/package.json';

/**
 * Runtime version constants for the environment block surfaced by /api/settings.
 *
 * The HotMesh SDK version is read from its package.json — node module
 * resolution finds it in both dev (source) and prod (the runtime image's
 * node_modules), and resolveJsonModule handles the static import at compile time.
 */
export const HOTMESH_VERSION: string = (hotmeshPkg as { version?: string }).version ?? 'unknown';

/**
 * The long-tail app version. Read from the root package.json at runtime via the
 * process working directory (which is the app root in both dev and the Docker
 * image, where CMD runs `node build/index.js` from /app). A static
 * `../package.json` import would resolve to build/package.json after compile —
 * a path the Dockerfile does not copy — so this reads from cwd instead.
 */
export const LONG_TAIL_VERSION: string = readLongTailVersion();

function readLongTailVersion(): string {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
