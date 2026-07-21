import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { parseResolverPayload, ResolverPayloadTypeError } from '../../lib/typed-resolution';

const IntakeSchema = z.object({
  customer: z.object({ name: z.string(), email: z.string() }),
  approved: z.boolean(),
});

describe('parseResolverPayload', () => {
  it('returns the typed value for a conforming payload', () => {
    const value = parseResolverPayload(IntakeSchema, {
      customer: { name: 'Acme', email: 'ops@acme.example' },
      approved: true,
    });
    expect(value.customer.name).toBe('Acme');
    expect(value.approved).toBe(true);
  });

  it('throws with a per-field violation list on a drifted payload', () => {
    try {
      parseResolverPayload(IntakeSchema, { customer: { name: 'Acme' }, approved: 'yes' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ResolverPayloadTypeError);
      const typed = err as ResolverPayloadTypeError;
      expect(typed.violations.map((v) => v.field).sort()).toEqual(['approved', 'customer.email']);
      expect(typed.message).toContain('customer.email');
      expect(typed.cause).toBeInstanceOf(z.ZodError);
    }
  });

  it('reports root-level mismatches as (root)', () => {
    try {
      parseResolverPayload(IntakeSchema, 'a string');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ResolverPayloadTypeError).violations[0].field).toBe('(root)');
    }
  });
});
