import { describe, it, expect } from 'vitest';

import {
  validateResolverForm,
  validateResolverPayload,
  mapFormToPayload,
} from '../../../shared/form-validation';

// ─────────────────────────────────────────────────────────────────────────────
// The isomorphic validation pass — the same loop the dashboard runs before
// submitting and the API layer runs on enforce_schema roles. The server entry
// point inverts x-lt-bind first, so a payload assembled from passing form
// values must pass, and violations must match what the client panel shows.
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA: Record<string, any> = {
  required: ['customer_name', 'contact_email', 'tier', 'approved'],
  properties: {
    customer_name: { type: 'string', 'x-lt-bind': 'customer.name' },
    contact_email: { type: 'string', format: 'email', 'x-lt-bind': 'customer.email' },
    tier: { type: 'string', enum: ['starter', 'professional'], 'x-lt-bind': 'contract.tier' },
    budget: { type: 'number', minimum: 0, 'x-lt-bind': 'contract.budget' },
    approved: { type: 'boolean', 'x-lt-bind': 'contract.approved' },
    notes: { type: 'string' },
    reason: { type: 'string', 'x-lt-showIf': '!resolver.approved' },
  },
};

const VALID_FORM = {
  customer_name: 'Acme Widgets LLC',
  contact_email: 'ops@acme.example',
  tier: 'professional',
  budget: 100,
  approved: true,
  notes: 'ok',
};

describe('validateResolverForm (client entry)', () => {
  it('passes a complete flat submission', () => {
    expect(validateResolverForm(SCHEMA, VALID_FORM)).toEqual([]);
  });

  it('reports required fields with the panel message', () => {
    const errors = validateResolverForm(SCHEMA, { approved: true });
    const fields = errors.map((e) => e.field);
    expect(fields).toContain('customer_name');
    expect(fields).toContain('contact_email');
    expect(fields).toContain('tier');
    expect(errors.find((e) => e.field === 'customer_name')?.message).toBe('Required');
  });

  it('skips showIf-hidden fields entirely', () => {
    // approved=true hides `reason` (!resolver.approved) — even an invalid
    // hidden value must never block submission.
    const errors = validateResolverForm(
      { required: ['reason'], properties: SCHEMA.properties },
      { ...VALID_FORM, reason: undefined },
    );
    expect(errors.map((e) => e.field)).not.toContain('reason');
  });

  it('validates showIf-visible fields against the live resolver values', () => {
    // approved=false shows `reason`; required list including it now applies.
    const errors = validateResolverForm(
      { required: ['reason'], properties: SCHEMA.properties },
      { ...VALID_FORM, approved: false },
    );
    expect(errors.map((e) => e.field)).toContain('reason');
  });
});

describe('validateResolverPayload (server entry)', () => {
  it('accepts the bound nested payload assembled from passing form values', () => {
    const payload = mapFormToPayload(VALID_FORM, SCHEMA);
    expect(payload.customer.name).toBe('Acme Widgets LLC');
    expect(validateResolverPayload(SCHEMA, payload)).toEqual([]);
  });

  it('finds a missing bound field inside the nested payload', () => {
    const payload = mapFormToPayload(VALID_FORM, SCHEMA);
    delete payload.customer.email;
    const errors = validateResolverPayload(SCHEMA, payload);
    expect(errors).toEqual([{ field: 'contact_email', message: 'Required' }]);
  });

  it('reports the same errors the client pass reports (parity)', () => {
    const badForm = { ...VALID_FORM, contact_email: 'not-an-email', budget: -5 };
    const clientErrors = validateResolverForm(SCHEMA, badForm);
    const serverErrors = validateResolverPayload(SCHEMA, mapFormToPayload(badForm, SCHEMA));
    expect(serverErrors).toEqual(clientErrors);
    expect(serverErrors.map((e) => e.field).sort()).toEqual(['budget', 'contact_email']);
  });

  it('evaluates showIf against the FLAT reconstruction, matching the client', () => {
    // approved rides at contract.approved in the payload, but the showIf
    // condition references resolver.approved — the flat field name.
    const form = { ...VALID_FORM, approved: false, reason: 'declined: budget' };
    const schema = { required: ['reason'], properties: SCHEMA.properties };
    const payload = mapFormToPayload(form, schema);
    expect(validateResolverPayload(schema, payload)).toEqual([]);
    delete payload.reason;
    expect(validateResolverPayload(schema, payload)).toEqual([
      { field: 'reason', message: 'Required' },
    ]);
  });

  it('resolves dynamic bounds from the escalation context', () => {
    const schema = {
      required: [],
      properties: { score: { type: 'number', 'x-lt-minimum': 'envelope.min_score' } },
    };
    const ctx = { envelope: { min_score: 10 } };
    expect(validateResolverPayload(schema, { score: 5 }, ctx)).toEqual([
      { field: 'score', message: 'Minimum value is 10' },
    ]);
    expect(validateResolverPayload(schema, { score: 15 }, ctx)).toEqual([]);
  });

  it('enforces x-lt-require-all against checklist items riding the envelope', () => {
    const schema = {
      required: [],
      properties: {
        checks: {
          type: 'object',
          'x-lt-widget': 'checklist',
          'x-lt-require-all': true,
          'x-lt-source': 'envelope.items',
        },
      },
    };
    const ctx = { envelope: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } };
    expect(validateResolverPayload(schema, { checks: { a: true } }, ctx)).toEqual([
      { field: 'checks', message: '1 of 2 checks incomplete' },
    ]);
    expect(validateResolverPayload(schema, { checks: { a: true, b: true } }, ctx)).toEqual([]);
  });

  it('returns no errors when the schema is null (nothing to enforce)', () => {
    expect(validateResolverPayload(null, { anything: true })).toEqual([]);
  });
});
