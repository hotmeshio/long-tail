import * as configService from '../services/config';
import type {
  LTResolvedConfig,
  LTLifecycleHook,
  LTProviderData,
} from '../types';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

class LTConfigCache {
  private configs: Map<string, LTResolvedConfig> | null = null;
  private loadedAt = 0;
  private loadPromise: Promise<Map<string, LTResolvedConfig>> | null = null;

  private async ensureLoaded(): Promise<Map<string, LTResolvedConfig>> {
    if (this.configs && Date.now() - this.loadedAt < TTL_MS) {
      return this.configs;
    }
    if (!this.loadPromise) {
      this.loadPromise = configService
        .loadAllConfigs()
        .then((configs) => {
          this.configs = configs;
          this.loadedAt = Date.now();
          return configs;
        })
        .finally(() => {
          this.loadPromise = null;
        });
    }
    return this.loadPromise;
  }

  private async get(name: string): Promise<LTResolvedConfig | undefined> {
    const configs = await this.ensureLoaded();
    return configs.get(name);
  }

  async isLTWorkflow(name: string): Promise<boolean> {
    const config = await this.get(name);
    return config?.isLT ?? false;
  }

  async isContainer(name: string): Promise<boolean> {
    const config = await this.get(name);
    return config?.isContainer ?? false;
  }

  async getTargetEscalationRole(name: string): Promise<string> {
    const config = await this.get(name);
    return config?.role ?? 'reviewer';
  }

  async getAllowedEscalationRoles(name: string): Promise<string[]> {
    const config = await this.get(name);
    return config?.roles ?? [];
  }

  async getDefaultModality(name: string): Promise<string> {
    const config = await this.get(name);
    return config?.modality ?? 'default';
  }

  async getOnBefore(name: string): Promise<LTLifecycleHook[]> {
    const config = await this.get(name);
    return config?.onBefore ?? [];
  }

  async getOnAfter(name: string): Promise<LTLifecycleHook[]> {
    const config = await this.get(name);
    return config?.onAfter ?? [];
  }

  async hasOnBefore(name: string): Promise<boolean> {
    const hooks = await this.getOnBefore(name);
    return hooks.length > 0;
  }

  async hasOnAfter(name: string): Promise<boolean> {
    const hooks = await this.getOnAfter(name);
    return hooks.length > 0;
  }

  async getProviders(name: string): Promise<string[]> {
    const config = await this.get(name);
    return config?.consumes ?? [];
  }

  async getProviderData(
    name: string,
    originId: string,
  ): Promise<LTProviderData> {
    const consumes = await this.getProviders(name);
    if (!consumes.length || !originId) return {};
    return configService.getProviderData(consumes, originId);
  }

  /** Force cache reload on next access. Call after config mutations. */
  invalidate(): void {
    this.configs = null;
    this.loadedAt = 0;
    this.loadPromise = null;
  }

  /** Get the full resolved config for a workflow (used by interceptor activities). */
  async getResolvedConfig(name: string): Promise<LTResolvedConfig | null> {
    const config = await this.get(name);
    return config ?? null;
  }
}

export const ltConfig = new LTConfigCache();
