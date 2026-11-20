import { useState, useEffect, useCallback, useRef } from 'react';
import { stabilizeValues } from '../../../lib/stabilize-values';
import type { FieldReview as FieldReviewState } from '../../../lib/x-lt-confidence';
import type { JsonValue } from './form-cells';

/**
 * The form's state: the edited JSON parsed into fields, the hidden `_` keys
 * kept for the payload, and the embedded schema. Values and schema keep their
 * identity across edits that do not change them, and each field's handlers and
 * review are cached, so a field re-renders only for its own edit.
 */
export function useResolverFormState(value: string, onChange: (json: string) => void) {
  const [data, setData] = useState<Record<string, JsonValue>>({});
  const [hidden, setHidden] = useState<Record<string, JsonValue>>({});
  const [formSchema, setFormSchema] = useState<Record<string, any> | null>(null);
  const [parseError, setParseError] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const schemaJsonRef = useRef('');

  // Parse incoming JSON
  useEffect(() => {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const visible: Record<string, JsonValue> = {};
        const internal: Record<string, JsonValue> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (k.startsWith('_') || k.startsWith('$')) {
            internal[k] = v as JsonValue;
          } else {
            visible[k] = v as JsonValue;
          }
        }
        setData((prev) => stabilizeValues(prev, visible));
        setHidden((prev) => stabilizeValues(prev, internal));
        const schema = internal._form_schema && typeof internal._form_schema === 'object'
          ? internal._form_schema as Record<string, any>
          : null;
        const schemaJson = schema ? JSON.stringify(schema) : '';
        if (schemaJson !== schemaJsonRef.current) {
          schemaJsonRef.current = schemaJson;
          setFormSchema(schema);
        }
        setParseError(false);
      }
    } catch {
      setParseError(true);
    }
  }, [value]);

  const emitChange = useCallback((updated: Record<string, JsonValue>) => {
    setData(updated);
    onChange(JSON.stringify({ ...updated, ...hidden }, null, 2));
  }, [hidden, onChange]);

  // Handlers read the latest state through a ref and are cached per field, so a
  // field's props stay identical while another field is edited.
  const latest = useRef({ data, emitChange });
  latest.current = { data, emitChange };
  const updateField = useCallback((key: string, val: JsonValue) => {
    latest.current.emitChange({ ...latest.current.data, [key]: val });
  }, []);
  const handlers = useRef(new Map<string, { change: (v: JsonValue) => void; blur: () => void }>());
  const handlersFor = (key: string) => {
    let entry = handlers.current.get(key);
    if (!entry) {
      entry = { change: (v) => updateField(key, v), blur: () => markTouchedRef.current(key) };
      handlers.current.set(key, entry);
    }
    return entry;
  };
  const reviews = useRef(new Map<string, { json: string; review: FieldReviewState }>());
  const stableReview = (key: string, review: FieldReviewState | undefined) => {
    if (!review) return undefined;
    const json = JSON.stringify(review);
    const cached = reviews.current.get(key);
    if (cached?.json === json) return cached.review;
    reviews.current.set(key, { json, review });
    return review;
  };

  const markTouched = useCallback((key: string) => {
    setTouched((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  const markTouchedRef = useRef(markTouched);
  markTouchedRef.current = markTouched;

  return { data, formSchema, parseError, touched, updateField, markTouched, handlersFor, stableReview };
}
