import { describe, it, expect } from 'vitest';
import { pickPaths, resolveJsonPath } from '../../../lib/json-path/pick';

const doc = {
  status: 0,
  data: { order: { manifest: { items: 3 }, po: 'X9' }, blob: 'x'.repeat(50) },
  timeline: [
    { activity: 'design', ms: 12 },
    { activity: 'print', ms: 90 },
  ],
};

describe('resolveJsonPath', () => {
  it('walks nested objects and array indices', () => {
    expect(resolveJsonPath(doc, 'data.order.po')).toBe('X9');
    expect(resolveJsonPath(doc, 'timeline.1.activity')).toBe('print');
  });

  it('returns undefined for a missing segment', () => {
    expect(resolveJsonPath(doc, 'data.order.missing.deep')).toBeUndefined();
  });
});

describe('pickPaths', () => {
  it('projects to exactly the requested paths, preserving nesting', () => {
    const out = pickPaths(doc, ['data.order.manifest', 'status']) as Record<string, any>;
    expect(out).toEqual({ data: { order: { manifest: { items: 3 } } }, status: 0 });
    // the heavy sibling is gone
    expect(out.data.blob).toBeUndefined();
  });

  it('rebuilds arrays for numeric segments', () => {
    const out = pickPaths(doc, ['timeline.0.activity']) as Record<string, any>;
    expect(Array.isArray(out.timeline)).toBe(true);
    expect(out.timeline[0]).toEqual({ activity: 'design' });
  });

  it('silently omits paths that do not resolve', () => {
    const out = pickPaths(doc, ['status', 'nope.nothing']) as Record<string, any>;
    expect(out).toEqual({ status: 0 });
  });

  it('returns the value unchanged when no paths are requested', () => {
    expect(pickPaths(doc, undefined)).toBe(doc);
    expect(pickPaths(doc, [])).toBe(doc);
  });
});
