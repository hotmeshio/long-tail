import { config } from '../../modules/config';
import type { LTUserRecord } from '../../types';

let protectIdentityKeys = config.LT_PROTECT_IDENTITY_KEYS;

/**
 * Whether identity keys are protected: left out of user reads, refused in
 * wholesale metadata writes, and written only with credentialIssuer. On by
 * default; start({ labels: { protectIdentityKeys: false } }) turns it off.
 */
export function setIdentityKeyProtection(on: boolean): void {
  protectIdentityKeys = on;
}

export function identityKeysProtected(): boolean {
  return protectIdentityKeys;
}

/**
 * A user record as a reader sees it. `identity_bound` names the identity keys
 * the user carries; while protection is on, their values (badge tokens and
 * other printed credentials) leave `metadata`, and printing a credential is
 * the only path that reveals one.
 */
export function redactIdentityKeys<T extends Pick<LTUserRecord, 'metadata'>>(
  user: T,
  identityKeys: string[],
): T & { identity_bound: string[] } {
  const metadata = user.metadata ? { ...user.metadata } : user.metadata;
  const bound = identityKeys.filter((key) => !!metadata && key in metadata);
  if (metadata && protectIdentityKeys) for (const key of bound) delete metadata[key];
  return { ...user, metadata, identity_bound: bound };
}
