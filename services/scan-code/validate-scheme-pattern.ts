import {
  SCAN_ENCODINGS,
  SCAN_PATTERN_MAX_LENGTH,
  SCAN_PATTERNS_MAX,
  SCAN_SCHEME_KINDS,
  SCAN_TARGET_MATCH,
  type ScanScheme,
} from '../../types';
import { compilePattern } from '../../shared/scan-code';

/**
 * The pattern-encoding fields and the target match. A pattern scheme
 * declares 1 to SCAN_PATTERNS_MAX expressions, each compiling and none
 * matching an empty code; other encodings declare none. A list-valued
 * target (`member`) applies to action schemes, whose targets resolve
 * against escalation metadata.
 */
export function assertValidPatternFields(scheme: Partial<ScanScheme>): void {
  const encoding = scheme.encoding ?? SCAN_ENCODINGS.FIXED;
  const patterns = scheme.patterns ?? [];
  if (!Array.isArray(patterns)) throw new Error('patterns must be a list of regular expressions');
  if (encoding === SCAN_ENCODINGS.PATTERN) {
    if (patterns.length < 1 || patterns.length > SCAN_PATTERNS_MAX) {
      throw new Error(`pattern encoding requires 1 to ${SCAN_PATTERNS_MAX} patterns`);
    }
    for (const pattern of patterns) assertValidPattern(pattern);
  } else {
    if (patterns.length > 0) throw new Error('patterns apply only to pattern encoding');
    if (scheme.precedes_gtin === true) throw new Error('precedes_gtin applies only to pattern encoding');
  }
  const match = scheme.target_match ?? SCAN_TARGET_MATCH.VALUE;
  if (!(Object.values(SCAN_TARGET_MATCH) as string[]).includes(match)) {
    throw new Error(`unknown target_match "${match}"`);
  }
  if (match === SCAN_TARGET_MATCH.MEMBER && (scheme.kind ?? SCAN_SCHEME_KINDS.ACTION) !== SCAN_SCHEME_KINDS.ACTION) {
    throw new Error('target_match member applies only to action schemes');
  }
}

/**
 * A pattern scheme and an enabled gtin scheme may both read a digits-only
 * code, so while both are enabled the pattern scheme declares which reads it
 * first (`precedes_gtin`). Checked from either side of the pair; throws
 * naming both schemes.
 */
export function assertGtinOrderDeclared(candidate: Partial<ScanScheme>, others: ScanScheme[]): void {
  if (!(candidate.enabled ?? true)) return;
  const encoding = candidate.encoding ?? SCAN_ENCODINGS.FIXED;
  if (encoding === SCAN_ENCODINGS.PATTERN && candidate.precedes_gtin == null) {
    const gtin = others.find((s) => s.enabled && s.encoding === SCAN_ENCODINGS.GTIN);
    if (gtin) {
      throw new Error(`gtin scheme ${gtin.version} ("${gtin.name}") also reads digits-only codes; declare precedes_gtin: true to read them with these patterns first, or false to leave them to the gtin scheme`);
    }
  }
  if (encoding === SCAN_ENCODINGS.GTIN) {
    const pattern = others.find((s) => s.enabled && s.encoding === SCAN_ENCODINGS.PATTERN && s.precedes_gtin == null);
    if (pattern) {
      throw new Error(`pattern scheme ${pattern.version} ("${pattern.name}") has not declared precedes_gtin; declare whether its patterns read digits-only codes before the gtin scheme, then enable the gtin scheme`);
    }
  }
}

function assertValidPattern(pattern: unknown): void {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('each pattern must be a non-empty string');
  }
  if (pattern.length > SCAN_PATTERN_MAX_LENGTH) {
    throw new Error(`pattern "${pattern.slice(0, 32)}…" exceeds ${SCAN_PATTERN_MAX_LENGTH} characters`);
  }
  const regex = compilePattern(pattern);
  if (!regex) throw new Error(`pattern "${pattern}" is not a valid regular expression`);
  if (regex.test('')) throw new Error(`pattern "${pattern}" matches an empty code`);
}
