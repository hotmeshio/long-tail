import {
  SCAN_ENCODINGS,
  SCAN_TEMPLATE_TOKENS,
  type ParsedScanCode,
  type ScanScheme,
} from '../../types';

export interface ScanParseFailure {
  /** Why the code did not parse. */
  reason: 'empty' | 'unknown_version' | 'scheme_disabled' | 'malformed';
  detail: string;
}

export type ScanParseResult =
  | { ok: true; parsed: ParsedScanCode; scheme: ScanScheme }
  | { ok: false; failure: ScanParseFailure };

/**
 * Parse a raw scan string against the configured schemes. Pure — no I/O.
 *
 * The leading digit picks the scheme; the scheme then defines how the
 * remainder splits into category (two digits) and target:
 * - delimited: `1:01:ABC-123` (delimiter from the scheme row)
 * - fixed:     `101755433211` (two category digits, then target_length digits)
 */
export function parseScanCode(raw: string, schemes: ScanScheme[]): ScanParseResult {
  const code = raw.trim();
  if (!code) {
    return { ok: false, failure: { reason: 'empty', detail: 'empty scan code' } };
  }

  const version = Number(code[0]);
  if (!Number.isInteger(version) || version < 1 || version > 9) {
    return {
      ok: false,
      failure: { reason: 'unknown_version', detail: `code must start with a version digit 1-9, got "${code[0]}"` },
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

  if (scheme.encoding === SCAN_ENCODINGS.DELIMITED) {
    return parseDelimited(code, version, scheme);
  }
  return parseFixed(code, version, scheme);
}

function parseDelimited(code: string, version: number, scheme: ScanScheme): ScanParseResult {
  const d = scheme.delimiter;
  // version <d> category(2 digits) <d> target(rest, non-empty)
  if (code[1] !== d) {
    return malformed(scheme, `expected "${d}" after the version digit`);
  }
  const category = code.slice(2, 4);
  if (!/^[0-9]{2}$/.test(category)) {
    return malformed(scheme, 'category must be two digits');
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

function parseFixed(code: string, version: number, scheme: ScanScheme): ScanParseResult {
  const targetLength = scheme.target_length ?? 0;
  const expected = 1 + 2 + targetLength;
  // UPC-A wedges deliver the trailing check digit too; accept it as slack.
  if (!/^[0-9]+$/.test(code)) {
    return malformed(scheme, 'fixed encoding accepts digits only');
  }
  if (code.length !== expected && code.length !== expected + 1) {
    return malformed(scheme, `expected ${expected} digits (or ${expected + 1} with check digit), got ${code.length}`);
  }
  const category = code.slice(1, 3);
  const target = code.slice(3, 3 + targetLength);
  return { ok: true, parsed: { version, category, target }, scheme };
}

function malformed(scheme: ScanScheme, detail: string): ScanParseResult {
  return {
    ok: false,
    failure: { reason: 'malformed', detail: `scheme ${scheme.version} ("${scheme.name}"): ${detail}` },
  };
}

export interface ScanTemplateContext {
  target: string;
  category: string;
  scannedAt: string;
}

/**
 * Replace SCAN_TEMPLATE_TOKENS inside string values of a params object.
 * Deep, pure, non-mutating. Only exact-token and in-string replacement of
 * the three known tokens — no expression language.
 */
export function interpolateScanTemplate<T>(value: T, ctx: ScanTemplateContext): T {
  if (typeof value === 'string') {
    return value
      .split(SCAN_TEMPLATE_TOKENS.TARGET).join(ctx.target)
      .split(SCAN_TEMPLATE_TOKENS.CATEGORY).join(ctx.category)
      .split(SCAN_TEMPLATE_TOKENS.SCANNED_AT).join(ctx.scannedAt) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateScanTemplate(v, ctx)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateScanTemplate(v, ctx);
    }
    return out as unknown as T;
  }
  return value;
}
