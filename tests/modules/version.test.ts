import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

import { LONG_TAIL_VERSION, HOTMESH_VERSION } from '../../modules/version';

/** long-tail's own version, read independently from the repo package.json. */
const OWN_VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version: string }
).version;

describe('version constants', () => {
  it('resolves the long-tail version from its own package.json', () => {
    expect(LONG_TAIL_VERSION).toBe(OWN_VERSION);
    expect(LONG_TAIL_VERSION).not.toBe('unknown');
  });

  it('resolves the HotMesh SDK version from its package.json', () => {
    expect(typeof HOTMESH_VERSION).toBe('string');
    expect(HOTMESH_VERSION.length).toBeGreaterThan(0);
    expect(HOTMESH_VERSION === 'unknown' || /^\d+\.\d+\.\d+/.test(HOTMESH_VERSION)).toBe(true);
  });
});

describe('LONG_TAIL_VERSION — dependency safety (consumed as a module)', () => {
  const origCwd = process.cwd();

  afterEach(() => {
    process.chdir(origCwd);
    vi.resetModules();
  });

  it('reports long-tail\'s own version even when cwd is a host app with a different version', async () => {
    // Reproduce the NestJS-module case: the host app's cwd has version 2.0.0.
    const tmp = mkdtempSync(join(tmpdir(), 'lt-ver-host-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'host-app', version: '2.0.0' }));
    try {
      process.chdir(tmp);
      vi.resetModules();
      const { LONG_TAIL_VERSION: resolved } = await import('../../modules/version');
      // Must be long-tail's version, NOT the host's 2.0.0.
      expect(resolved).toBe(OWN_VERSION);
      expect(resolved).not.toBe('2.0.0');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
