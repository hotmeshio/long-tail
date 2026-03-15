import * as configService from '../services/config';
import { CONFIG_CACHE_TTL_MS } from './defaults';
import type {
  LTResolvedConfig,
  LTProviderData,
} from '../types';

const TTL_MS = CONFIG_CACHE_TTL_MS;

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

  async isInvocable(name: string): Promise<boolean> {
    const config = await this.get(name);
    return config?.invocable ?? false;
  }

  async getInvocationRoles(name: string): Promise<string[]> {
    const config = await this.get(name);
    return config?.invocationRoles ?? [];
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

  async getToolTags(name: string): Promise<string[]> {
    const config = await this.get(name);
    return config?.toolTags ?? [];
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
