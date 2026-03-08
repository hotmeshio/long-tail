import { describe, it, expect } from 'vitest';

import {
  hmshTimestampToISO,
  computeDuration,
  fromString,
  sanitizeAppId,
  quoteSchema,
  inflateAttributes,
  restoreHierarchy,
  extractActivities,
} from '../services/hotmesh-utils';

// ── hmshTimestampToISO ──────────────────────────────────────────────────────

describe('hmshTimestampToISO', () => {
  it('converts a compact HotMesh timestamp to ISO 8601', () => {
    expect(hmshTimestampToISO('20260308143957.744')).toBe('2026-03-08T14:39:57.744Z');
  });

  it('handles timestamps without milliseconds', () => {
    expect(hmshTimestampToISO('20260308143957.000')).toBe('2026-03-08T14:39:57.000Z');
  });

  it('returns short strings unchanged', () => {
    expect(hmshTimestampToISO('short')).toBe('short');
  });

  it('returns empty string unchanged', () => {
    expect(hmshTimestampToISO('')).toBe('');
  });
});

// ── computeDuration ─────────────────────────────────────────────────────────

describe('computeDuration', () => {
  it('computes millisecond difference between two timestamps', () => {
    const result = computeDuration('20260308143957.756', '20260308143957.780');
    expect(result).toBe(24);
  });

  it('computes multi-second duration', () => {
    const result = computeDuration('20260308143957.744', '20260308144008.394');
    expect(result).toBe(10650);
  });

  it('returns null when ac is missing', () => {
    expect(computeDuration(undefined, '20260308143957.780')).toBeNull();
  });

  it('returns null when au is missing', () => {
    expect(computeDuration('20260308143957.756', undefined)).toBeNull();
  });

  it('returns null when both are missing', () => {
    expect(computeDuration(undefined, undefined)).toBeNull();
  });
});

// ── fromString ──────────────────────────────────────────────────────────────

describe('fromString', () => {
  it('parses /s prefix as JSON object', () => {
    expect(fromString('/s{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('parses /s prefix as JSON array', () => {
    expect(fromString('/s[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses /d prefix as number', () => {
    expect(fromString('/d42')).toBe(42);
  });

  it('parses /d prefix as float', () => {
    expect(fromString('/d3.14')).toBe(3.14);
  });

  it('parses /t as true', () => {
    expect(fromString('/t')).toBe(true);
  });

  it('parses /f as false', () => {
    expect(fromString('/f')).toBe(false);
  });

  it('parses /n as null', () => {
    expect(fromString('/n')).toBeNull();
  });

  it('returns plain strings as-is', () => {
    expect(fromString('hello world')).toBe('hello world');
  });

  it('returns compact timestamps as strings', () => {
    expect(fromString('20260308143957.744')).toBe('20260308143957.744');
  });
});

// ── sanitizeAppId ───────────────────────────────────────────────────────────

describe('sanitizeAppId', () => {
  it('accepts valid alphanumeric IDs', () => {
    expect(sanitizeAppId('longtail')).toBe('longtail');
  });

  it('accepts IDs with hyphens and underscores', () => {
    expect(sanitizeAppId('my-app_v2')).toBe('my-app_v2');
  });

  it('accepts IDs with dots', () => {
    expect(sanitizeAppId('app.v1.0')).toBe('app.v1.0');
  });

  it('rejects IDs with spaces', () => {
    expect(() => sanitizeAppId('bad id')).toThrow('Invalid app_id');
  });

  it('rejects IDs with SQL injection attempts', () => {
    expect(() => sanitizeAppId("'; DROP TABLE --")).toThrow('Invalid app_id');
  });

  it('rejects empty string', () => {
    expect(() => sanitizeAppId('')).toThrow('Invalid app_id');
  });
});

// ── quoteSchema ─────────────────────────────────────────────────────────────

describe('quoteSchema', () => {
  it('wraps schema name in double quotes', () => {
    expect(quoteSchema('longtail')).toBe('"longtail"');
  });

  it('escapes double quotes in schema name', () => {
    expect(quoteSchema('my"schema')).toBe('"my""schema"');
  });
});

// ── inflateAttributes ───────────────────────────────────────────────────────

describe('inflateAttributes', () => {
  const symbolMap: Record<string, string> = {
    aoa: 'metadata/jc',
    apa: 'metadata/ju',
    asa: 'metadata/trc',
    aBa: 'data/summary',
    afl: 'act_a1/output/metadata/ac',
    agl: 'act_a1/output/metadata/au',
    ail: 'act_a1/output/metadata/l1s',
    ajl: 'act_a1/output/metadata/l2s',
  };

  it('inflates 3-char job-level keys', () => {
    const attrs = { aoa: '20260308143957.744', asa: 'abc123' };
    const result = inflateAttributes(attrs, symbolMap);
    expect(result['metadata/jc']).toBe('20260308143957.744');
    expect(result['metadata/trc']).toBe('abc123');
  });

  it('inflates dimensional activity keys', () => {
    const attrs = { 'afl,0,0': '20260308143957.756' };
    const result = inflateAttributes(attrs, symbolMap);
    expect(result['0/0/act_a1/output/metadata/ac']).toBe('20260308143957.756');
  });

  it('deserializes /s values as JSON', () => {
    const attrs = { aBa: '/s{"key":"val"}' };
    const result = inflateAttributes(attrs, symbolMap);
    expect(result['data/summary']).toEqual({ key: 'val' });
  });

  it('preserves the status semaphore', () => {
    const attrs = { ':': '1' };
    const result = inflateAttributes(attrs, symbolMap);
    expect(result[':']).toBe('1');
  });

  it('preserves literal mark keys', () => {
    const attrs = { 'HabcDEF123': '11000000000' };
    const result = inflateAttributes(attrs, symbolMap);
    expect(result['HabcDEF123']).toBe('11000000000');
  });

  it('falls back to raw key when not in symbol map', () => {
    const attrs = { xyz: 'hello' };
    const result = inflateAttributes(attrs, symbolMap);
    expect(result['xyz']).toBe('hello');
  });
});

// ── restoreHierarchy ────────────────────────────────────────────────────────

describe('restoreHierarchy', () => {
  it('rebuilds nested object from flat paths', () => {
    const flat = {
      'metadata/jc': '20260308143957.744',
      'metadata/trc': 'abc123',
      'data/summary': 'hello',
    };
    const result = restoreHierarchy(flat);
    expect(result).toEqual({
      metadata: { jc: '20260308143957.744', trc: 'abc123' },
      data: { summary: 'hello' },
    });
  });

  it('rebuilds dimensional hierarchy', () => {
    const flat = {
      '0/act_t1/output/metadata/ac': '20260308143957.749',
      '0/0/act_a1/output/metadata/ac': '20260308143957.756',
    };
    const result = restoreHierarchy(flat);
    expect((result as any)['0']['act_t1']['output']['metadata']['ac']).toBe('20260308143957.749');
    expect((result as any)['0']['0']['act_a1']['output']['metadata']['ac']).toBe('20260308143957.756');
  });

  it('skips undefined values', () => {
    const flat = { 'a/b': undefined, 'a/c': 'val' };
    const result = restoreHierarchy(flat);
    expect(result).toEqual({ a: { c: 'val' } });
  });
});

// ── extractActivities ───────────────────────────────────────────────────────

describe('extractActivities', () => {
  it('extracts activities from an inflated hierarchy', () => {
    const hierarchy = {
      metadata: { jc: '20260308143957.744', trc: 'trace123' },
      data: { summary: 'test' },
      '0': {
        trigger_t1: {
          output: {
            metadata: {
              aid: 'trigger_t1',
              atp: 'trigger',
              ac: '20260308143957.749',
              au: '20260308143957.749',
              l1s: 'trace_t1',
              l2s: 'span_t1',
            },
          },
        },
        '0': {
          worker_a1: {
            output: {
              metadata: {
                aid: 'worker_a1',
                atp: 'worker',
                stp: 'my-flow.get_data',
                ac: '20260308143957.756',
                au: '20260308143957.780',
                l1s: 'trace_a1',
                l2s: 'span_a1',
              },
              data: {
                result: 'hello',
              },
            },
          },
        },
      },
    };

    const activities = extractActivities(hierarchy);
    expect(activities).toHaveLength(2);

    // Sorted by ac timestamp — trigger first (749), then worker (756)
    expect(activities[0].name).toBe('trigger_t1');
    expect(activities[0].type).toBe('trigger');
    expect(activities[0].traceId).toBe('trace_t1');
    expect(activities[0].spanId).toBe('span_t1');
    expect(activities[0].data).toBeNull(); // triggers have no data

    expect(activities[1].name).toBe('worker_a1');
    expect(activities[1].type).toBe('worker');
    expect(activities[1].step).toBe('my-flow.get_data');
    expect(activities[1].traceId).toBe('trace_a1');
    expect(activities[1].spanId).toBe('span_a1');
    expect(activities[1].data).toEqual({ result: 'hello' });
    expect(activities[1].dimensions).toBe('0/0');
  });

  it('returns empty array when no activities found', () => {
    const hierarchy = { metadata: { jc: '20260308143957.744' } };
    expect(extractActivities(hierarchy)).toEqual([]);
  });

  it('handles activities with errors', () => {
    const hierarchy = {
      '0': {
        '0': {
          failed_a1: {
            output: {
              metadata: {
                atp: 'worker',
                ac: '20260308143957.756',
                au: '20260308143957.780',
                err: 'connection timeout',
              },
            },
          },
        },
      },
    };

    const activities = extractActivities(hierarchy);
    expect(activities).toHaveLength(1);
    expect(activities[0].error).toBe('connection timeout');
  });
});
