import { describe, it, expect } from 'vitest';
import { buildResolverPayload } from '../resolver-payload';

const withSchema = (fields: Record<string, unknown>, schema: Record<string, unknown>) =>
  JSON.stringify({ ...fields, _form_schema: schema });

describe('buildResolverPayload', () => {
  it('reports a parse error for malformed JSON', () => {
    const result = buildResolverPayload('not json');
    expect(result.parseError).toBe('Invalid JSON');
    expect(result.payload).toBeNull();
    expect(result.errors).toEqual([]);
  });

  it('returns the payload untouched when there is no embedded schema', () => {
    const result = buildResolverPayload('{"approved": true}');
    expect(result.payload).toEqual({ approved: true });
    expect(result.errors).toEqual([]);
    expect(result.parseError).toBeNull();
  });

  it('strips _form_schema and returns the mapped payload when valid', () => {
    const json = withSchema({ approved: true }, {
      required: ['approved'],
      properties: { approved: { type: 'boolean' } },
    });
    const result = buildResolverPayload(json);
    expect(result.payload).toEqual({ approved: true });
    expect(result.errors).toEqual([]);
  });

  it('returns field errors and a null payload when a required field is empty', () => {
    const json = withSchema({ notes: '' }, {
      required: ['notes'],
      properties: { notes: { type: 'string' } },
    });
    const result = buildResolverPayload(json);
    expect(result.payload).toBeNull();
    expect(result.errors.some((e) => e.field === 'notes')).toBe(true);
  });

  it('skips required checks for fields hidden by x-lt-showIf against the context', () => {
    const json = withSchema({ action: '', notes: 'done' }, {
      required: ['action'],
      properties: {
        notes: { type: 'string' },
        action: { type: 'string', 'x-lt-showIf': 'metadata.crew_pill' },
      },
    });
    const result = buildResolverPayload(json, { metadata: {} });
    expect(result.errors).toEqual([]);
    expect(result.payload).toEqual({ action: '', notes: 'done' });
  });
});
