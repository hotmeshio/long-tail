// Scan-code parsing. Pure and isomorphic: the server parses every scan with
// it, and the dashboard parses locally to route a scan into an open form.

import { isValidGtin, normalizeGtin } from './gtin';

/** The scheme fields parsing reads. The server's ScanScheme satisfies it. */
export interface ParseableScheme {
  version: number;
  name: string;
  encoding: 'fixed' | 'delimited' | 'gtin' | 'pattern';
  delimiter: string;
  target_length: number | null;
  /** Pattern encoding: regular expressions over the whole code. */
  patterns?: string[];
  /** Pattern encoding: true reads a digits-only code before the gtin scheme does. */
  precedes_gtin?: boolean | null;
  enabled: boolean;
}

export interface ParsedCode {
  version: number;
  category: string;
  target: string;
  /** The code as scanned, when the target was normalized from it (GTIN). */
  raw?: string;
}

export interface ScanParseFailure {
  /** Why the code did not parse. */
  reason: 'empty' | 'unknown_version' | 'scheme_disabled' | 'malformed';
  detail: string;
}

export type ScanParseResult<S extends ParseableScheme = ParseableScheme> =
  | { ok: true; parsed: ParsedCode; scheme: S }
  | { ok: false; failure: ScanParseFailure };

const GTIN_CATEGORY = '0';
const PATTERN_CATEGORY = '0';

/**
 * The longest code a pattern scheme reads. Declared expressions run only on
 * codes up to this length, which bounds their cost on any input; carrier
 * tracking numbers run to 34 characters.
 */
export const PATTERN_CODE_MAX_LENGTH = 64;

/**
 * Parse a raw scan string against the configured schemes.
 *
 * The leading TWO digits pick the scheme (10-99, so a code never starts with a
 * leading zero); the scheme then defines how the remainder splits into a
 * single-digit category (0-9) and the target:
 * - delimited: `10:1:ABC-123` (delimiter from the scheme row)
 * - fixed:     `1017554332` (one category digit, then target_length digits)
 *
 * A digits-only code that no fixed scheme reads is a manufacturer barcode
 * when a gtin scheme is configured and its check digit holds: the target is
 * the 14-digit GTIN and the category is '0'. Config validation keeps fixed
 * and gtin lengths apart, so the order here never decides a real code.
 *
 * A code no prefixed scheme reads is matched against the pattern schemes'
 * declared expressions, lowest version first: the target is the code as
 * scanned and the category is '0'. A pattern scheme with `precedes_gtin`
 * reads a digits-only code before the gtin scheme does.
 */
export function parseScanCode<S extends ParseableScheme>(raw: string, schemes: S[]): ScanParseResult<S> {
  const code = raw.trim();
  if (!code) {
    return { ok: false, failure: { reason: 'empty', detail: 'empty scan code' } };
  }
  const prefixed = parsePrefixed(code, schemes);
  if (prefixed.ok) return prefixed;
  return parsePattern(code, schemes, false) ?? prefixed;
}

/** The fixed, gtin and delimited reading of a code, with the gtin-first pattern schemes. */
function parsePrefixed<S extends ParseableScheme>(code: string, schemes: S[]): ScanParseResult<S> {
  if (/^[0-9]+$/.test(code)) {
    const fixed = schemes.find((s) => s.encoding === 'fixed' && s.version === Number(code.slice(0, 2)));
    const fixedFits = fixed?.enabled && fitsFixed(code, fixed);
    if (!fixedFits) {
      const first = parsePattern(code, schemes, true);
      if (first) return first;
      const gtin = parseGtin(code, schemes);
      if (gtin) return gtin;
    }
  }

  const versionToken = code.slice(0, 2);
  const version = Number(versionToken);
  if (!/^[0-9]{2}$/.test(versionToken) || version < 10 || version > 99) {
    return {
      ok: false,
      failure: { reason: 'unknown_version', detail: `code must start with a two-digit scheme 10-99, got "${versionToken}"` },
    };
  }

  const scheme = schemes.find((s) => s.version === version);
  if (!scheme) {
    return {
      ok: false,
      failure: { reason: 'unknown_version', detail: `no scan scheme configured for version ${version}` },
    };
  }
  if (!scheme.enabled) {
    return {
      ok: false,
      failure: { reason: 'scheme_disabled', detail: `scan scheme ${version} ("${scheme.name}") is disabled` },
    };
  }
  if (scheme.encoding === 'gtin') {
    return malformed(scheme, 'reads manufacturer barcodes, which carry no scheme prefix');
  }
  if (scheme.encoding === 'pattern') {
    return malformed(scheme, 'reads codes by its declared patterns, which carry no scheme prefix');
  }
  if (scheme.encoding === 'delimited') {
    return parseDelimited(code, version, scheme);
  }
  return parseFixed(code, version, scheme);
}

function fitsFixed(code: string, scheme: ParseableScheme): boolean {
  const expected = 3 + (scheme.target_length ?? 0);
  return code.length === expected || code.length === expected + 1;
}

/** A manufacturer barcode, or null when the code is not one any gtin scheme reads. */
function parseGtin<S extends ParseableScheme>(code: string, schemes: S[]): ScanParseResult<S> | null {
  if (!isValidGtin(code)) return null;
  const gtin = schemes.find((s) => s.encoding === 'gtin' && s.enabled)
    ?? schemes.find((s) => s.encoding === 'gtin');
  if (!gtin) return null;
  if (!gtin.enabled) {
    return {
      ok: false,
      failure: { reason: 'scheme_disabled', detail: `scan scheme ${gtin.version} ("${gtin.name}") is disabled` },
    };
  }
  return {
    ok: true,
    parsed: { version: gtin.version, category: GTIN_CATEGORY, target: normalizeGtin(code), raw: code },
    scheme: gtin,
  };
}

/**
 * The pattern scheme whose expressions match the whole code, lowest version
 * first, or null. `gtinFirst` limits the search to schemes that precede gtin.
 * A match on a disabled scheme only answers when no enabled one matches.
 */
function parsePattern<S extends ParseableScheme>(code: string, schemes: S[], gtinFirst: boolean): ScanParseResult<S> | null {
  const matching = schemes
    .filter((s) => s.encoding === 'pattern' && (!gtinFirst || s.precedes_gtin))
    .filter((s) => patternsMatch(s.patterns ?? [], code))
    .sort((a, b) => a.version - b.version);
  const scheme = matching.find((s) => s.enabled) ?? matching[0];
  if (!scheme) return null;
  if (!scheme.enabled) {
    return {
      ok: false,
      failure: { reason: 'scheme_disabled', detail: `scan scheme ${scheme.version} ("${scheme.name}") is disabled` },
    };
  }
  return { ok: true, parsed: { version: scheme.version, category: PATTERN_CATEGORY, target: code }, scheme };
}

/** True when the code is within the pattern length and one of the expressions matches all of it. */
export function patternsMatch(patterns: string[], code: string): boolean {
  if (code.length > PATTERN_CODE_MAX_LENGTH) return false;
  return patterns.some((p) => compilePattern(p)?.test(code));
}

const compiled = new Map<string, RegExp | null>();

/** A declared expression anchored to the whole code; null when it does not compile. */
export function compilePattern(pattern: string): RegExp | null {
  if (compiled.has(pattern)) return compiled.get(pattern)!;
  let regex: RegExp | null;
  try {
    regex = new RegExp(`^(?:${unanchorPattern(pattern)})$`);
  } catch {
    regex = null;
  }
  compiled.set(pattern, regex);
  return regex;
}

/** The expression without one leading `^` and one unescaped trailing `$`. */
export function unanchorPattern(pattern: string): string {
  let body = pattern.startsWith('^') ? pattern.slice(1) : pattern;
  if (body.endsWith('$') && !body.endsWith('\\$')) body = body.slice(0, -1);
  return body;
}

function parseDelimited<S extends ParseableScheme>(code: string, version: number, scheme: S): ScanParseResult<S> {
  const d = scheme.delimiter;
  // version(2 digits) <d> category(1 digit) <d> target(rest, non-empty)
  if (code[2] !== d) {
    return malformed(scheme, `expected "${d}" after the two-digit scheme`);
  }
  const category = code.slice(3, 4);
  if (!/^[0-9]$/.test(category)) {
    return malformed(scheme, 'category must be a single digit');
  }
  if (code[4] !== d) {
    return malformed(scheme, `expected "${d}" after the category`);
  }
  const target = code.slice(5);
  if (!target) {
    return malformed(scheme, 'target is empty');
  }
  return { ok: true, parsed: { version, category, target }, scheme };
}

function parseFixed<S extends ParseableScheme>(code: string, version: number, scheme: S): ScanParseResult<S> {
  const targetLength = scheme.target_length ?? 0;
  const expected = 2 + 1 + targetLength;
  // UPC-A wedges deliver the trailing check digit too; accept it as slack.
  if (!/^[0-9]+$/.test(code)) {
    return malformed(scheme, 'fixed encoding accepts digits only');
  }
  if (code.length !== expected && code.length !== expected + 1) {
    return malformed(scheme, `expected ${expected} digits (or ${expected + 1} with check digit), got ${code.length}`);
  }
  const category = code.slice(2, 3);
  const target = code.slice(3, 3 + targetLength);
  return { ok: true, parsed: { version, category, target }, scheme };
}

function malformed<S extends ParseableScheme>(scheme: S, detail: string): ScanParseResult<S> {
  return {
    ok: false,
    failure: { reason: 'malformed', detail: `scheme ${scheme.version} ("${scheme.name}"): ${detail}` },
  };
}

/** The total code lengths a fixed scheme accepts (with and without the check-digit slack). */
export function fixedCodeLengths(scheme: Pick<ParseableScheme, 'target_length'>): number[] {
  const expected = 3 + (scheme.target_length ?? 0);
  return [expected, expected + 1];
}
