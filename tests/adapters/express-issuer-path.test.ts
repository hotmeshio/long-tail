import { describe, it, expect, vi, afterEach } from 'vitest';

// A host mounting the well-known router hears when its issuer names a path
// other than where Long Tail is mounted.
const warn = vi.hoisted(() => vi.fn());
vi.mock('../../lib/logger', async (io) => {
  const actual = await io<typeof import('../../lib/logger')>();
  return { ...actual, loggerRegistry: { ...actual.loggerRegistry, warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } };
});

import { LTExpressAdapter } from '../../adapters/express';
import { setOAuthServerConfig, clearOAuthServerConfig } from '../../modules/oauth-server';

const adapterAt = (basePath: string) => {
  const adapter = new LTExpressAdapter();
  adapter.setBasePath(basePath);
  return adapter;
};

afterEach(() => {
  clearOAuthServerConfig();
  warn.mockClear();
});

describe('LTExpressAdapter.getWellKnownRouter', () => {
  it('warns when the issuer path is not the mount path', () => {
    setOAuthServerConfig({ issuer: 'https://host.example' });
    adapterAt('/longtail').getWellKnownRouter();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('set the issuer to https://<host>/longtail'));
  });

  it('is quiet when they match, at a subpath or at the root', () => {
    setOAuthServerConfig({ issuer: 'https://host.example/longtail/' });
    adapterAt('/longtail').getWellKnownRouter();
    setOAuthServerConfig({ issuer: 'https://host.example' });
    adapterAt('').getWellKnownRouter();
    expect(warn).not.toHaveBeenCalled();
  });

  it('is quiet when no authorization server is configured', () => {
    adapterAt('/longtail').getWellKnownRouter();
    expect(warn).not.toHaveBeenCalled();
  });
});
