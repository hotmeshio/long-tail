// New identity credentials, minted to fit the scheme's encoding.

import { randomBytes, randomInt } from 'crypto';

import type { ScanScheme } from '../../types';
import { LabelRequestError } from './errors';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DELIMITED_TOKEN_LENGTH = 24;
/** Fixed targets shorter than this carry too little entropy to be a credential alone. */
export const WEAK_FIXED_TOKEN_LENGTH = 12;

/** A random credential for the scheme: Crockford base32 when delimited, digits when fixed. */
export function mintIdentityToken(scheme: Pick<ScanScheme, 'encoding' | 'target_length'>): string {
  if (scheme.encoding === 'delimited') {
    const bytes = randomBytes(DELIMITED_TOKEN_LENGTH);
    return Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
  }
  if (scheme.encoding === 'fixed') {
    const length = scheme.target_length ?? 0;
    if (length < 1) throw new LabelRequestError(400, 'the scheme has no target length');
    return Array.from({ length }, () => String(randomInt(10))).join('');
  }
  throw new LabelRequestError(400, `credentials are minted for fixed and delimited schemes, not ${scheme.encoding}`);
}
