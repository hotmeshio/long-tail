import type { LTSSOConfig } from '../types/auth';

let _ssoConfig: LTSSOConfig | null = null;

export function setSSOConfig(config: LTSSOConfig): void {
  _ssoConfig = config;
}

export function getSSOConfig(): LTSSOConfig | null {
  return _ssoConfig;
}

export function isSSOEnabled(): boolean {
  return _ssoConfig !== null;
}

/** Reset SSO config. Used by tests. */
export function clearSSOConfig(): void {
  _ssoConfig = null;
}
