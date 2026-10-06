/**
 * x-lt-scan: a form field that takes a scan.
 *
 * While a form is open and editable, a scan whose scheme a field accepts
 * fills that field instead of running globally. The field may declare what
 * it expects (paths into the escalation context); a scan outside that set
 * is a field error and is not written, and the same check runs server-side
 * at submit, so a typed wrong value is refused there too.
 *
 *   "containerCode": { "type": "string", "x-lt-scan": {
 *      "schemes": [14], "expect": ["metadata.containerCode"],
 *      "expect-error": "This item goes in {{expected}}." } }
 *   "parts": { "type": "array", "items": { "type": "string" },
 *      "x-lt-scan": { "schemes": [16], "expect": ["envelope.expected_upcs"], "multiplicity": "count" } }
 *
 * Root `x-lt-scan-submit: true` submits once every required scan field is
 * filled and the form validates. A string field is replaced by a scan; an
 * array field appends, and with `multiplicity: "count"` a value expected n
 * times takes n scans.
 */
import { resolveCtxPath } from './ctx-path';

export const X_LT_SCAN = 'x-lt-scan';
export const X_LT_SCAN_SUBMIT = 'x-lt-scan-submit';
export const X_LT_ORDER = 'x-lt-order';

const DEFAULT_EXPECT_ERROR = 'Expected {{expected}}';

export interface ScanSink {
  schemes: number[];
  /** The scanned target (default) or the code as scanned. */
  value: 'target' | 'code';
  /** Context paths whose values the field accepts. */
  expect?: string[];
  expectError: string;
  /** Array fields: 'count' takes a value as many times as it is expected. */
  multiplicity: 'count' | 'once';
}

/** The parts of a parsed scan a sink reads. */
export interface SinkScan {
  version: number;
  target: string;
  code: string;
}

type Schema = Record<string, unknown>;

/** The field's scan configuration, or null when it takes no scans. */
export function readScanSink(fieldSchema: Schema | undefined): ScanSink | null {
  const raw = fieldSchema?.[X_LT_SCAN];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cfg = raw as Record<string, unknown>;
  const schemes = Array.isArray(cfg.schemes) ? cfg.schemes.filter((v): v is number => Number.isInteger(v)) : [];
  if (schemes.length === 0) return null;
  const expect = Array.isArray(cfg.expect) ? cfg.expect.filter((v): v is string => typeof v === 'string') : undefined;
  return {
    schemes,
    value: cfg.value === 'code' ? 'code' : 'target',
    ...(expect?.length ? { expect } : {}),
    expectError: typeof cfg['expect-error'] === 'string' ? cfg['expect-error'] : DEFAULT_EXPECT_ERROR,
    multiplicity: cfg.multiplicity === 'count' ? 'count' : 'once',
  };
}

/** Manufacturer barcodes compare as GTINs, so a UPC-A matches its 14-digit form. */
export function sameScanValue(a: string, b: string): boolean {
  if (a === b) return true;
  const gtin = /^[0-9]{8,14}$/;
  return gtin.test(a) && gtin.test(b) && a.padStart(14, '0') === b.padStart(14, '0');
}

/** The values the field accepts, flattened; null when it declares none. */
export function resolveScanExpected(sink: ScanSink, ctx: Record<string, unknown> | undefined): string[] | null {
  if (!sink.expect) return null;
  const out: string[] = [];
  for (const path of sink.expect) {
    const value = resolveCtxPath(path, ctx);
    const list = Array.isArray(value) ? value : [value];
    for (const v of list) {
      if (typeof v === 'string' && v) out.push(v);
      else if (typeof v === 'number') out.push(String(v));
    }
  }
  return out;
}

function expectMessage(sink: ScanSink, expected: string[]): string {
  return sink.expectError.replace(/\{\{\s*expected\s*\}\}/g, [...new Set(expected)].join(', ') || 'nothing');
}

/**
 * The field's error for its current value against what it expects, or
 * undefined. Strings must be one of the expected values; arrays may hold
 * each expected value once (or as many times as expected, with 'count').
 */
export function scanSinkError(
  value: unknown,
  fieldSchema: Schema | undefined,
  ctx: Record<string, unknown> | undefined,
): string | undefined {
  const sink = readScanSink(fieldSchema);
  if (!sink) return undefined;
  const expected = resolveScanExpected(sink, ctx);
  if (expected === null) return undefined;
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  // Each expected value admits one scan; 'count' keeps repeats as separate admissions.
  const budget = sink.multiplicity === 'count' ? [...expected] : [...new Set(expected)];
  for (const v of values) {
    const at = budget.findIndex((e) => sameScanValue(String(v), e));
    if (at === -1) return expectMessage(sink, expected);
    budget.splice(at, 1);
  }
  return undefined;
}

/** What a scan does to a field: the next value, or the error to show (nothing written). */
export function applyScanToField(
  current: unknown,
  scan: SinkScan,
  fieldSchema: Schema,
  ctx: Record<string, unknown> | undefined,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const sink = readScanSink(fieldSchema);
  if (!sink) return { ok: false, error: 'This field takes no scans' };
  const scanned = sink.value === 'code' ? scan.code : scan.target;
  const isArray = fieldSchema.type === 'array';
  const next = isArray ? [...(Array.isArray(current) ? current : []), scanned] : scanned;
  const error = scanSinkError(next, fieldSchema, ctx);
  if (error) return { ok: false, error };
  const max = fieldSchema.maxItems;
  if (isArray && typeof max === 'number' && (next as unknown[]).length > max) {
    return { ok: false, error: `At most ${max}` };
  }
  return { ok: true, value: next };
}

/** True when the field has room for another scan. */
function hasRoom(value: unknown, fieldSchema: Schema): boolean {
  if (fieldSchema.type === 'array') {
    const max = fieldSchema.maxItems;
    return typeof max !== 'number' || !Array.isArray(value) || value.length < max;
  }
  return value === undefined || value === null || value === '';
}

/**
 * The field a scan from `version` fills: the focused field when it takes
 * that scheme, otherwise the first (in x-lt-order) that takes it and has
 * room, otherwise the first that takes it. Null: no field takes it, so the
 * scan runs globally.
 */
export function pickScanSink(
  schema: Schema | null | undefined,
  values: Record<string, unknown>,
  version: number,
  focusedField?: string | null,
): string | null {
  const properties = (schema?.properties ?? {}) as Record<string, Schema>;
  const order = Array.isArray(schema?.[X_LT_ORDER]) ? (schema![X_LT_ORDER] as string[]) : [];
  const names = [...order.filter((n) => n in properties), ...Object.keys(properties).filter((n) => !order.includes(n))];
  const takes = names.filter((n) => readScanSink(properties[n])?.schemes.includes(version));
  if (takes.length === 0) return null;
  if (focusedField && takes.includes(focusedField)) return focusedField;
  return takes.find((n) => hasRoom(values[n], properties[n])) ?? takes[0];
}

/** True when the form submits on its own once its scan fields are filled. */
export function wantsScanSubmit(schema: Schema | null | undefined): boolean {
  return schema?.[X_LT_SCAN_SUBMIT] === true;
}

/** True when every required scan field holds a value. */
export function scanFieldsFilled(schema: Schema | null | undefined, values: Record<string, unknown>): boolean {
  const properties = (schema?.properties ?? {}) as Record<string, Schema>;
  const required = new Set((schema?.required as string[] | undefined) ?? []);
  const sinks = Object.keys(properties).filter((n) => readScanSink(properties[n]) && required.has(n));
  if (sinks.length === 0) return false;
  return sinks.every((n) => {
    const v = values[n];
    if (Array.isArray(v)) {
      const min = properties[n].minItems;
      return v.length >= (typeof min === 'number' ? min : 1);
    }
    return v !== undefined && v !== null && v !== '';
  });
}
