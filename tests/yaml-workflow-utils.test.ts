import { describe, it, expect } from 'vitest';

import { parseVersionFromYaml } from '../services/yaml-workflow/db';
import { compactForLlm } from '../services/yaml-workflow/workers';
import { capToolArguments } from '../services/yaml-workflow/generator';
import {
  TOOL_ARG_LIMIT_CAP,
  LLM_MAX_ARRAY_ITEMS,
} from '../modules/defaults';

// ── parseVersionFromYaml ───────────────────────────────────────

describe('parseVersionFromYaml', () => {
  it('extracts a quoted version from a standard app block', () => {
    const yaml = `app:\n  id: foo\n  version: '2'`;
    expect(parseVersionFromYaml(yaml)).toBe('2');
  });

  it('extracts an unquoted version', () => {
    const yaml = `app:\n  id: bar\n  version: 3`;
    expect(parseVersionFromYaml(yaml)).toBe('3');
  });

  it('returns null when there is no version field', () => {
    const yaml = `app:\n  id: baz`;
    expect(parseVersionFromYaml(yaml)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseVersionFromYaml('')).toBeNull();
  });

  it('does not match a version field outside the app block', () => {
    const yaml = `other:\n  version: 9\napp:\n  id: x`;
    expect(parseVersionFromYaml(yaml)).toBeNull();
  });
});

// ── compactForLlm ──────────────────────────────────────────────

describe('compactForLlm', () => {
  it(`truncates arrays longer than ${LLM_MAX_ARRAY_ITEMS} items`, () => {
    const arr = Array.from({ length: LLM_MAX_ARRAY_ITEMS + 5 }, (_, i) => i);
    const result = compactForLlm({ items: arr });
    const items = result.items as unknown[];
    expect(items).toHaveLength(LLM_MAX_ARRAY_ITEMS + 1); // capped items + 1 truncation message
    expect(items[LLM_MAX_ARRAY_ITEMS]).toBe('... (5 more)');
  });

  it('strips trace_id, span_id, and resolved_at from objects', () => {
    const result = compactForLlm({
      trace_id: 'abc',
      span_id: 'def',
      resolved_at: '2024-01-01',
      keep: 'yes',
    });
    expect(result).toEqual({ keep: 'yes' });
  });

  it('recursively processes nested objects', () => {
    const result = compactForLlm({
      outer: { trace_id: 'x', value: 42 },
    });
    expect(result).toEqual({ outer: { value: 42 } });
  });

  it('passes through small arrays unchanged', () => {
    const result = compactForLlm({ tags: ['a', 'b', 'c'] });
    expect(result).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('passes through primitive values unchanged', () => {
    const result = compactForLlm({ count: 7, label: 'test', flag: true });
    expect(result).toEqual({ count: 7, label: 'test', flag: true });
  });
});

// ── capToolArguments ───────────────────────────────────────────

describe('capToolArguments', () => {
  it(`caps limit > ${TOOL_ARG_LIMIT_CAP} to ${TOOL_ARG_LIMIT_CAP}`, () => {
    expect(capToolArguments({ limit: 100 })).toEqual({ limit: TOOL_ARG_LIMIT_CAP });
  });

  it(`leaves limit <= ${TOOL_ARG_LIMIT_CAP} unchanged`, () => {
    expect(capToolArguments({ limit: 10 })).toEqual({ limit: 10 });
    expect(capToolArguments({ limit: TOOL_ARG_LIMIT_CAP })).toEqual({ limit: TOOL_ARG_LIMIT_CAP });
  });

  it('passes through other arguments unchanged', () => {
    expect(capToolArguments({ query: 'select *', offset: 5 })).toEqual({
      query: 'select *',
      offset: 5,
    });
  });

  it('handles missing limit field', () => {
    expect(capToolArguments({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });
});
