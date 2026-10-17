import { describe, it, expect, vi } from 'vitest';

// The nightly cycle prunes the /mcp authorization server's dead rows, by default.
const mocks = vi.hoisted(() => ({
  cycle: null as null | (() => Promise<void>),
  pruneOAuthServer: vi.fn(async () => ({ refreshTokens: 3, codes: 2, grants: 1, clients: 0 })),
}));
vi.mock('@hotmeshio/hotmesh', () => ({
  Virtual: { cron: vi.fn(async ({ callback }: { callback: () => Promise<void> }) => { mocks.cycle = callback; }) },
}));
vi.mock('../../../lib/db', () => ({ getConnection: () => ({}) }));
vi.mock('../../../services/dba', () => ({ prune: vi.fn() }));
vi.mock('../../../services/escalation/client', () => ({ escalations: vi.fn() }));
vi.mock('../../../services/auth/oauth-server', () => ({ pruneOAuthServer: mocks.pruneOAuthServer }));

import { maintenanceRegistry } from '../../../services/maintenance';
import { defaultMaintenanceConfig } from '../../../modules/maintenance';

describe('maintenance oauth rule', () => {
  it('ships in the default rules', () => {
    expect(defaultMaintenanceConfig.rules).toContainEqual({ target: 'oauth', action: 'delete', olderThan: '7 days' });
  });

  it('prunes the authorization server with the rule window', async () => {
    maintenanceRegistry.clear();
    maintenanceRegistry.register({ appId: 'durable', schedule: '1 day', rules: [{ target: 'oauth', action: 'delete', olderThan: '14 days' }] });
    await maintenanceRegistry.connect();
    await mocks.cycle!();
    expect(mocks.pruneOAuthServer).toHaveBeenCalledWith('14 days');
    maintenanceRegistry.clear();
  });
});
