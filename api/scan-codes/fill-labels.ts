import * as scanCodeService from '../../services/scan-code';
import { resolveCtxPath } from '../../shared/form-validation/ctx-path';
import { getDeep } from '../../shared/form-validation/x-lt-bind';
import { SCAN_ENCODINGS, type LTEscalationRecord, type ScanFillParams, type ScanScheme } from '../../types';

const LABEL_TOKEN = /\{label\.([^}]+)\}/g;
const CODE_TOKEN = '{code}';

/** How a batch entry reads: its label from the row's per-key map, or its code. */
export type EntryLabeler = (key: string, code: string) => string;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A JSON column as an object: the row's envelope arrives as text. */
function asObject(v: unknown): Record<string, unknown> | null {
  if (isRecord(v)) return v;
  if (typeof v !== 'string' || !v) return null;
  try {
    const parsed = JSON.parse(v);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The code as the package prints it on a GTIN scheme, as scanned otherwise. */
export function printedCode(code: string, scheme: ScanScheme): string {
  return scheme.encoding === SCAN_ENCODINGS.GTIN ? scanCodeService.displayGtin(code) : code;
}

/**
 * The labeler a fill step declares, or null without `labels`. The map is
 * read from the batch row (`envelope.<map>` or `metadata.<map>`) and keyed by
 * batch key. With a `label` template, `{label.<path>}` reads the entry's map
 * value and `{code}` its printed code; without one, a text value is the
 * label. An entry the map does not name reads as its code.
 */
export function entryLabeler(fill: ScanFillParams, row: LTEscalationRecord, scheme: ScanScheme): EntryLabeler | null {
  if (!fill.labels) return null;
  const map = resolveCtxPath(fill.labels, { envelope: asObject(row.envelope), metadata: asObject(row.metadata) });
  const labels = isRecord(map) ? map : {};
  return (key, code) => {
    const printed = printedCode(code, scheme);
    const value = labels[key];
    if (value === undefined || value === null) return printed;
    if (fill.label) {
      const text = fill.label
        .split(CODE_TOKEN).join(printed)
        .replace(LABEL_TOKEN, (_t, path: string) => {
          const v = isRecord(value) ? getDeep(value, path) : undefined;
          return v === undefined || v === null || typeof v === 'object' ? '' : String(v);
        })
        .trim();
      return text || printed;
    }
    return typeof value === 'string' && value ? value : printed;
  };
}

/** Each open entry's label, in batch order, one per distinct label. */
export function pendingLabels(pending: string[], codeOf: (key: string) => string, label: EntryLabeler): string[] {
  return [...new Set(pending.map((key) => label(key, codeOf(key))))];
}
