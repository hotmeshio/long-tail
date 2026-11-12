import { describe, it, expect, afterEach } from 'vitest';

import { durableProviderRegistry } from '../../../services/durable-provider/registry';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

describe('durableProviderRegistry', () => {
  afterEach(() => durableProviderRegistry.clear());

  it('reports HotMesh as native before anything registers', () => {
    expect(durableProviderRegistry.hasProvider).toBe(false);
    expect(durableProviderRegistry.isNative).toBe(true);
    expect(durableProviderRegistry.name).toBe('hotmesh');
  });

  it('throws when the current provider is read before registration', () => {
    expect(() => durableProviderRegistry.current).toThrow(/No durable provider/);
  });

  it('holds the registered provider and its config', () => {
    const provider = new FakeDurableProvider('temporal');
    durableProviderRegistry.register(provider, { consoleUrl: 'https://ui/{workflowId}' });
    expect(durableProviderRegistry.current).toBe(provider);
    expect(durableProviderRegistry.name).toBe('temporal');
    expect(durableProviderRegistry.isNative).toBe(false);
    expect(durableProviderRegistry.settings.consoleUrl).toBe('https://ui/{workflowId}');
  });

  it('clears back to the default', () => {
    durableProviderRegistry.register(new FakeDurableProvider());
    durableProviderRegistry.clear();
    expect(durableProviderRegistry.hasProvider).toBe(false);
    expect(durableProviderRegistry.settings).toEqual({});
  });
});
