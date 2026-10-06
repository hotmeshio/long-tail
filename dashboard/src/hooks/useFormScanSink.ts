import { useEffect, useRef, useState } from 'react';
import { useOptionalScanInput } from './useScanInput';
import { useScanSchemes } from '../api/scan-codes';
import { parseScanCode } from '../../../shared/scan-code';
import {
  applyScanToField,
  pickScanSink,
  scanFieldsFilled,
  wantsScanSubmit,
} from '../lib/x-lt-scan';

/** What the last scan into the form did, for the field to show. */
export interface FormScanNotice {
  field: string;
  /** Set when the scan was refused; the field kept its value. */
  error: string | null;
  at: number;
}

/** The field that holds focus, by the data-field-key every form row carries. */
function focusedFieldKey(): string | null {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  return el instanceof HTMLElement ? el.closest('[data-field-key]')?.getAttribute('data-field-key') ?? null : null;
}

/**
 * An open, editable form takes scans meant for it. When the form declares a
 * field that accepts a scan's scheme (x-lt-scan), the scan fills that field
 * instead of running globally; a scan no field accepts, and every badge,
 * passes on to the scan pipeline unchanged. With x-lt-scan-submit, filling
 * the last required scan field submits the form (a station's submit still
 * asks for the badge).
 */
export function useFormScanSink({
  enabled,
  json,
  onJsonChange,
  context,
  onScanSubmit,
}: {
  enabled: boolean;
  /** The form's JSON (values plus `_form_schema`). */
  json: string;
  onJsonChange: (json: string) => void;
  /** The escalation context expected values resolve against. */
  context: Record<string, unknown> | undefined;
  /** Submit with the filled form. */
  onScanSubmit: (json: string) => void;
}): FormScanNotice | null {
  const pushCodeInterceptor = useOptionalScanInput()?.pushCodeInterceptor;
  const { data } = useScanSchemes({ enabled, staleTime: 60_000 });
  const [notice, setNotice] = useState<FormScanNotice | null>(null);

  // Live refs: the interceptor installs once and reads the current form.
  const live = useRef({ json, onJsonChange, context, onScanSubmit, schemes: data?.schemes ?? [] });
  live.current = { json, onJsonChange, context, onScanSubmit, schemes: data?.schemes ?? [] };

  useEffect(() => {
    if (!enabled || !pushCodeInterceptor) return;
    return pushCodeInterceptor((raw) => {
      const { json: current, schemes } = live.current;
      const parsed = parseScanCode(raw, schemes);
      if (!parsed.ok || parsed.scheme.kind !== 'action') return false;

      let form: Record<string, unknown>;
      try {
        form = JSON.parse(current) as Record<string, unknown>;
      } catch {
        return false;
      }
      const schema = form._form_schema as Record<string, unknown> | undefined;
      const field = pickScanSink(schema, form, parsed.parsed.version, focusedFieldKey());
      if (!schema || !field) return false;

      const fieldSchema = (schema.properties as Record<string, Record<string, unknown>>)[field];
      const scan = { version: parsed.parsed.version, target: parsed.parsed.target, code: parsed.parsed.raw ?? raw.trim() };
      const applied = applyScanToField(form[field], scan, fieldSchema, live.current.context);
      if (!applied.ok) {
        setNotice({ field, error: applied.error, at: Date.now() });
        return true;
      }
      const next = { ...form, [field]: applied.value };
      const nextJson = JSON.stringify(next, null, 2);
      live.current.onJsonChange(nextJson);
      setNotice({ field, error: null, at: Date.now() });
      if (wantsScanSubmit(schema) && scanFieldsFilled(schema, next)) live.current.onScanSubmit(nextJson);
      return true;
    });
  }, [enabled, pushCodeInterceptor]);

  return notice;
}
