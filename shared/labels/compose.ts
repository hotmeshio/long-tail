// The inverse of parseScanCode for the encodings the engine mints.

import type { ParseableScheme } from '../scan-code/parse';

/** A code that cannot be composed under its scheme. */
export class ScanComposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanComposeError';
  }
}

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/** Whether the scheme's codes are minted by the engine (and so printable from a template). */
export function isMintableScheme(scheme: Pick<ParseableScheme, 'encoding'>): boolean {
  return scheme.encoding === 'fixed' || scheme.encoding === 'delimited';
}

/**
 * The code a scan of `target` under `category` reads. Throws ScanComposeError
 * when the scheme only reads codes (gtin, pattern) or the target does not fit.
 */
export function composeScanCode(
  scheme: Pick<ParseableScheme, 'version' | 'encoding' | 'delimiter' | 'target_length'>,
  category: string,
  target: string,
): string {
  if (!/^[0-9]$/.test(category)) {
    throw new ScanComposeError(`category must be a single digit, got "${category}"`);
  }
  const version = String(scheme.version);
  if (scheme.encoding === 'delimited') {
    if (!target || !PRINTABLE_ASCII.test(target)) {
      throw new ScanComposeError(`target "${target}" must be printable ASCII with no spaces`);
    }
    return `${version}${scheme.delimiter}${category}${scheme.delimiter}${target}`;
  }
  if (scheme.encoding === 'fixed') {
    const length = scheme.target_length ?? 0;
    if (!new RegExp(`^[0-9]{${length}}$`).test(target)) {
      throw new ScanComposeError(`target "${target}" must be exactly ${length} digits`);
    }
    return `${version}${category}${target}`;
  }
  throw new ScanComposeError(`scheme ${version} reads ${scheme.encoding} codes; the engine does not mint them`);
}
