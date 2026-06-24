import { describe, it, expect } from 'vitest';

import { LONG_TAIL_VERSION, HOTMESH_VERSION } from '../../modules/version';

describe('version constants', () => {
  it('resolves the long-tail version from package.json (non-empty string)', () => {
    expect(typeof LONG_TAIL_VERSION).toBe('string');
    expect(LONG_TAIL_VERSION.length).toBeGreaterThan(0);
    // Either a semver string or the documented fallback.
    expect(LONG_TAIL_VERSION === 'unknown' || /^\d+\.\d+\.\d+/.test(LONG_TAIL_VERSION)).toBe(true);
  });

  it('resolves the HotMesh SDK version from its package.json', () => {
    expect(typeof HOTMESH_VERSION).toBe('string');
    expect(HOTMESH_VERSION.length).toBeGreaterThan(0);
    expect(HOTMESH_VERSION === 'unknown' || /^\d+\.\d+\.\d+/.test(HOTMESH_VERSION)).toBe(true);
  });
});
