import { describe, it, expect } from 'vitest';

import { mapFormToPayload, mapPayloadToForm, parsePath } from '../x-lt-bind';

// The intake form the rich-form role owns: bound fields map into nested groups,
// unbound fields (notes) sit at the root. Mirrors examples/workflows/rich-form.
const FORM_SCHEMA = {
  properties: {
    customer_name: { type: 'string', default: '', 'x-lt-bind': 'customer.name' },
    contact_email: { type: 'string', default: '', 'x-lt-bind': 'customer.email' },
    tier: { type: 'string', default: 'starter', 'x-lt-bind': 'contract.tier' },
    budget: { type: 'number', default: 0, 'x-lt-bind': 'contract.budget' },
    approved: { type: 'boolean', default: false, 'x-lt-bind': 'contract.approved' },
    notes: { type: 'string', default: '' }, // no bind → root
  },
};

const props = FORM_SCHEMA.properties as Record<string, any>;
const prefillFromDefaults = () => {
  const out: Record<string, any> = {};
  for (const [k, def] of Object.entries(props)) out[k] = def.default;
  return out;
};

describe('mapFormToPayload — nested form → payload', () => {
  it('maps bound fields into nested groups, unbound to the root', () => {
    const payload = mapFormToPayload(
      { customer_name: 'Acme', contact_email: 'a@acme.io', tier: 'professional', budget: 100, approved: true, notes: 'hi' },
      FORM_SCHEMA,
    );
    expect(payload).toEqual({
      customer: { name: 'Acme', email: 'a@acme.io' },
      contract: { tier: 'professional', budget: 100, approved: true },
      notes: 'hi',
    });
  });

  it('default values flow through untouched', () => {
    const payload = mapFormToPayload(prefillFromDefaults(), FORM_SCHEMA);
    expect(payload.contract).toEqual({ tier: 'starter', budget: 0, approved: false });
    expect(payload.customer).toEqual({ name: '', email: '' });
    expect(payload.notes).toBe('');
  });

  it('changed values override the defaults', () => {
    const form = { ...prefillFromDefaults(), tier: 'enterprise', customer_name: 'Globex' };
    const payload = mapFormToPayload(form, FORM_SCHEMA);
    expect(payload.contract.tier).toBe('enterprise');
    expect(payload.customer.name).toBe('Globex');
  });

  it('deleted fields are omitted from the payload (not sent as empty)', () => {
    const { budget, notes, ...form } = prefillFromDefaults(); // user cleared budget + notes
    const payload = mapFormToPayload(form, FORM_SCHEMA);
    expect('budget' in (payload.contract ?? {})).toBe(false);
    expect('notes' in payload).toBe(false);
    expect(payload.customer).toBeDefined();
  });

  it('drops keys not declared in the schema', () => {
    const payload = mapFormToPayload({ customer_name: 'Acme', rogue: 'x' }, FORM_SCHEMA);
    expect(payload).toEqual({ customer: { name: 'Acme' } });
  });

  it('a schema with no properties passes values through 1:1', () => {
    expect(mapFormToPayload({ a: 1, b: 2 }, {})).toEqual({ a: 1, b: 2 });
  });
});

describe('mapPayloadToForm — payload → form (prefill)', () => {
  it('pulls bound + unbound values back into flat form fields', () => {
    const form = mapPayloadToForm(
      { customer: { name: 'Acme', email: 'a@acme.io' }, contract: { tier: 'professional', budget: 100, approved: true }, notes: 'hi' },
      FORM_SCHEMA,
    );
    expect(form).toEqual({
      customer_name: 'Acme', contact_email: 'a@acme.io',
      tier: 'professional', budget: 100, approved: true, notes: 'hi',
    });
  });

  it('omits fields whose bound path is absent (caller falls back to defaults)', () => {
    const form = mapPayloadToForm({ customer: { name: 'Acme' } }, FORM_SCHEMA);
    expect(form).toEqual({ customer_name: 'Acme' });
    expect('tier' in form).toBe(false);
  });

  it('round-trips: form → payload → form is stable', () => {
    const original = { customer_name: 'Acme', contact_email: 'a@acme.io', tier: 'professional', budget: 100, approved: true, notes: 'hi' };
    expect(mapPayloadToForm(mapFormToPayload(original, FORM_SCHEMA), FORM_SCHEMA)).toEqual(original);
  });

  it('handles a null/empty payload', () => {
    expect(mapPayloadToForm(null, FORM_SCHEMA)).toEqual({});
  });
});

describe('parsePath — safety', () => {
  it('rejects prototype-pollution keys', () => {
    expect(() => parsePath('__proto__.polluted')).toThrow();
    expect(() => parsePath('a.constructor')).toThrow();
  });

  it('parses dotted keys and array indices', () => {
    expect(parsePath('a.b[0].c')).toEqual([{ key: 'a' }, { key: 'b' }, { index: 0 }, { key: 'c' }]);
  });
});
