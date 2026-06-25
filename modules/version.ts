import { readFileSync } from 'fs';
import { dirname, join, parse } from 'path';

import hotmeshPkg from '@hotmeshio/hotmesh/package.json';

/**
 * Runtime version constants for the environment block surfaced by /api/settings.
 *
 * The HotMesh SDK version is read from its package.json — node module
 * resolution finds it in both dev (source) and prod (the runtime image's
 * node_modules), and resolveJsonModule handles the static import at compile time.
 */
export const HOTMESH_VERSION: string = (hotmeshPkg as { version?: string }).version ?? 'unknown';

const LONG_TAIL_PACKAGE_NAME = '@hotmeshio/long-tail';

/**
 * The long-tail package version.
 *
 * Resolved from long-tail's OWN package.json by walking up from this module's
 * directory to the first package.json named `@hotmeshio/long-tail`. Reading
 * `process.cwd()/package.json` is wrong when long-tail is consumed as a
 * dependency (e.g. mounted as a NestJS module) — cwd is then the HOST app's
 * root, so it reported the host's version. The upward walk resolves correctly in
 * dev (source tree), the standalone Docker image (`/app`), and under
 * `node_modules/@hotmeshio/long-tail`. A static `../package.json` import can't be
 * used: post-compile it resolves to `build/package.json`, which is not shipped.
 */
export const LONG_TAIL_VERSION: string = readLongTailVersion();

function readLongTailVersion(): string {
  let dir = __dirname;
  const { root } = parse(dir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === LONG_TAIL_PACKAGE_NAME) return pkg.version ?? 'unknown';
    } catch {
      /* no readable package.json here — keep walking up */
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  return 'unknown';
}
