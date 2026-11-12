import { DURABLE_PROVIDER, type LTDurableConfig, type LTDurableProvider } from '../../types/durable-provider';

/**
 * The durable engine running customer workflows. One provider per deployment.
 * HotMesh is registered when the start config names none.
 */
class LTDurableProviderRegistry {
  private provider: LTDurableProvider | null = null;
  private config: LTDurableConfig = {};

  register(provider: LTDurableProvider, config: LTDurableConfig = {}): void {
    this.provider = provider;
    this.config = config;
  }

  clear(): void {
    this.provider = null;
    this.config = {};
  }

  get hasProvider(): boolean {
    return this.provider !== null;
  }

  get current(): LTDurableProvider {
    if (!this.provider) {
      throw new Error('No durable provider is registered; start() registers one from `durable.provider`');
    }
    return this.provider;
  }

  /** True when HotMesh runs customer workflows (the default). */
  get isNative(): boolean {
    return this.provider ? this.provider.capabilities.native : true;
  }

  get name(): string {
    return this.provider?.name ?? DURABLE_PROVIDER.HOTMESH;
  }

  get settings(): LTDurableConfig {
    return this.config;
  }
}

export const durableProviderRegistry = new LTDurableProviderRegistry();
