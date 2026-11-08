// New identity credentials, minted to fit the scheme's encoding.

import { randomBytes, randomInt } from 'crypto';

import type { ScanScheme } from '../../types';
import { LabelRequestError } from './errors';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters in a minted delimited credential when the scheme sets no target_length (about 50 bits). */
export const DEFAULT_IDENTITY_TOKEN_LENGTH = 10;

/**
 * A random credential for the scheme: Crockford base32 of the scheme's
 * target_length (default 10) when delimited, that many digits when fixed.
 * The scheme prefix is added when the code is composed, never stored.
 */
export function mintIdentityToken(scheme: Pick<ScanScheme, 'encoding' | 'target_length'>): string {
  if (scheme.encoding === 'delimited') {
    const bytes = randomBytes(scheme.target_length ?? DEFAULT_IDENTITY_TOKEN_LENGTH);
    return Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
  }
  if (scheme.encoding === 'fixed') {
    const length = scheme.target_length ?? 0;
    if (length < 1) throw new LabelRequestError(400, 'the scheme has no target length');
    return Array.from({ length }, () => String(randomInt(10))).join('');
  }
  throw new LabelRequestError(400, `credentials are minted for fixed and delimited schemes, not ${scheme.encoding}`);
}
