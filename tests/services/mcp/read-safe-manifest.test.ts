import { describe, it, expect } from 'vitest';

import { createAdminServer } from '../../../system/mcp-servers/admin';
import { ADMIN_TOOLS } from '../../../system/seed/tool-manifests-admin';

// ─────────────────────────────────────────────────────────────────────────────
// Read-safe manifest completeness
//
// The unified MCP endpoint gates read-scoped callers (mcp:read, exposure
// readOnly) on the tool manifest: a tool is exposed to them only when its
// manifest entry says read_safe: true. The gate fails closed — an unlisted
// tool is treated as a write tool. That model only protects correctly when
// the manifest is complete, so this suite pins manifest coverage to the
// actual registration list: registering a new admin tool without a manifest
// entry (or with a missing read_safe flag) fails here, at build time, rather
// than shipping a mis-scoped tool.
// ─────────────────────────────────────────────────────────────────────────────

const WRITE_TOOLS_SPOT_CHECK = [
  'update_role',
  'resolve_by_ids',
  'claim_by_facets',
  'claim_groups',
  'create_role',
];

describe('admin MCP read-safe manifest', () => {
  it('every registered admin tool has a manifest entry with an explicit read_safe flag', async () => {
    const server = await createAdminServer({ fresh: true, name: 'manifest-test' });
    const registered = Object.keys(
      (server as any)._registeredTools as Record<string, unknown>,
    ).sort();
    expect(registered.length).toBeGreaterThan(0);

    const manifestNames = new Set(ADMIN_TOOLS.map((t) => t.name));
    const unlisted = registered.filter((name) => !manifestNames.has(name));
    expect(unlisted).toEqual([]);

    for (const entry of ADMIN_TOOLS) {
      expect(typeof (entry as any).read_safe, `read_safe missing on ${entry.name}`).toBe('boolean');
    }
  });

  it('role and escalation write tools are marked read_safe: false', () => {
    for (const name of WRITE_TOOLS_SPOT_CHECK) {
      const entry = ADMIN_TOOLS.find((t) => t.name === name);
      expect(entry, `${name} missing from manifest`).toBeDefined();
      expect(entry!.read_safe, `${name} must be read_safe: false`).toBe(false);
    }
  });

  it('diagnostic read tools are marked read_safe: true', () => {
    for (const name of ['diagnose_job', 'find_stalled_jobs', 'find_orphaned_signals', 'search_by_facets']) {
      const entry = ADMIN_TOOLS.find((t) => t.name === name);
      expect(entry, `${name} missing from manifest`).toBeDefined();
      expect(entry!.read_safe, `${name} must be read_safe: true`).toBe(true);
    }
  });
});
