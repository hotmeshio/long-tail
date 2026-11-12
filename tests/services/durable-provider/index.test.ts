import { describe, it, expect, afterEach } from 'vitest';

import {
  assertDurableConfig,
  registerDurableProvider,
  durableProviderRegistry,
} from '../../../services/durable-provider';
import type { LTStartConfig } from '../../../types/startup';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

function withProvider(extra: Partial<LTStartConfig> = {}): LTStartConfig {
  return { durable: { provider: new FakeDurableProvider('temporal') }, ...extra } as LTStartConfig;
}

describe('durable provider start config', () => {
  afterEach(() => durableProviderRegistry.clear());

  it('accepts a provider with no HotMesh-only features', () => {
    expect(() => assertDurableConfig(withProvider())).not.toThrow();
  });

  it('accepts HotMesh-only features when no provider is set', () => {
    expect(() => assertDurableConfig({ escalation: { strategy: 'mcp' }, examples: true } as LTStartConfig)).not.toThrow();
  });

  it('throws on triage with a provider', () => {
    expect(() => assertDurableConfig(withProvider({ escalation: { strategy: 'mcp' } }))).toThrow(/triage/);
  });

  it('throws on HotMesh workers with a provider', () => {
    const config = withProvider({ workers: [{ taskQueue: 'q', workflow: 'w', connection: { readonly: true } }] as any });
    expect(() => assertDurableConfig(config)).toThrow(/workers/);
  });

  it('throws on examples with a provider', () => {
    expect(() => assertDurableConfig(withProvider({ examples: true }))).toThrow(/examples/);
  });

  it('registers HotMesh when none is configured', () => {
    registerDurableProvider({} as LTStartConfig);
    expect(durableProviderRegistry.name).toBe('hotmesh');
    expect(durableProviderRegistry.isNative).toBe(true);
  });

  it('registers the configured provider with its config', () => {
    registerDurableProvider({ durable: { provider: new FakeDurableProvider('dbos'), consoleUrl: 'x' } } as unknown as LTStartConfig);
    expect(durableProviderRegistry.name).toBe('dbos');
    expect(durableProviderRegistry.settings.consoleUrl).toBe('x');
  });
});
